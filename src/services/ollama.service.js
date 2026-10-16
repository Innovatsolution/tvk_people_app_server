import { env } from '../config/env.js'
import { ApiError } from '../utils/apiError.js'

export function buildSystemPrompt(today) {
  return `You convert an admin's question about citizen complaints into a JSON filter.
Return ONLY a raw JSON object (no markdown, no code fences, no explanation) using these optional keys:

- intent: "count" if the admin asks how many / the number / the total, otherwise "list"
- category: one of "road", "light", "water", "waste", "other"
    "light" = street light / lamp / electricity pole problems. "waste" = garbage, sanitation.
    If the topic is NOT one of these five (e.g. drainage, ration shop), leave category out and put the topic word in textContains.
- status: one of "submitted", "accepted", "rejected", "pending", "completed"
    "submitted" = new / filed / not reviewed yet. "pending" = accepted and being worked on / in progress.
    "completed" = resolved / done / closed.
- displayId: a complaint number like "TVK_AZK_0011". If the admin gives only a number or a partial form (e.g. "azk 11", "complaint 11"), return "TVK_AZK_" plus the number padded to 4 digits.
- userId: a user id, only if one is given
- wardContains: a short keyword from the ward / street / location, e.g. "3rd ward" or "pillayar kovil"
- textContains: a short keyword to look for in the complaint title or description
- fromDate / toDate: YYYY-MM-DD

Today is ${today} (India time). "today" = ${today}. "last week" = the last 7 days up to today. "this month" = from the 1st of this month.
Only include keys the admin actually asked for. For "all complaints" or "how many complaints are registered", return {"intent":"count"} or {} accordingly.`
}

const FILTER_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    category: { type: 'string' },
    status: { type: 'string' },
    displayId: { type: 'string' },
    userId: { type: 'string' },
    wardContains: { type: 'string' },
    textContains: { type: 'string' },
    fromDate: { type: 'string' },
    toDate: { type: 'string' },
  },
}

// The model sometimes wraps JSON in ``` fences or adds a sentence around it.
function parseJsonObject(text) {
  const clean = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON object in the response')
  return JSON.parse(clean.slice(start, end + 1))
}

/**
 * Sends the question to Ollama and returns its (untrusted) JSON filter.
 * `config` can be overridden for tests.
 */
export async function askOllamaForFilter(question, { today, config = env.ollama } = {}) {
  if (!config.apiKey) {
    throw ApiError.coded(503, 'CHATBOT_NOT_CONFIGURED', 'The chatbot is not set up on the server yet (OLLAMA_API_KEY is missing).')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  let response
  try {
    response = await fetch(config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        options: { temperature: 0 },
        format: FILTER_SCHEMA,
        messages: [
          { role: 'system', content: buildSystemPrompt(today) },
          { role: 'user', content: question },
        ],
      }),
    })
  } catch (err) {
    const timedOut = err?.name === 'AbortError'
    console.error('[chatbot] Ollama request failed:', timedOut ? 'timed out' : err?.message)
    throw ApiError.coded(
      502,
      'CHATBOT_UNAVAILABLE',
      timedOut ? 'The AI service took too long to answer. Please try again.' : 'The AI service could not be reached. Please try again.'
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // Log the upstream detail for whoever runs the server, but don't hand it to the browser.
    console.error('[chatbot] Ollama returned', response.status, await response.text().catch(() => ''))
    if (response.status === 401 || response.status === 403) {
      throw ApiError.coded(502, 'CHATBOT_AUTH_FAILED', "The AI service rejected the server's API key.")
    }
    throw ApiError.coded(502, 'CHATBOT_UPSTREAM_ERROR', `The AI service returned an error (HTTP ${response.status}).`)
  }

  try {
    const data = await response.json()
    return parseJsonObject(data?.message?.content || '')
  } catch (err) {
    console.error('[chatbot] Could not parse the AI response:', err.message)
    throw ApiError.coded(502, 'CHATBOT_BAD_RESPONSE', "I couldn't understand the AI's answer. Please try rephrasing your question.")
  }
}
