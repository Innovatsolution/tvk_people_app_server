// Run with: npm run test:chatbot
// Tests the admin chatbot's logic with fake data and a local fake "Ollama" server -
// no Firestore, no real API key, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

// ---- a local fake Ollama server (started before env.js is imported) ----------
let mode = 'ok'
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(body || '{}') })
    const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
    const content = (c) => send(200, { message: { content: c } })
    if (mode === 'ok') return content('{"category":"water"}')
    if (mode === 'fenced') return content('```json\n{"status":"pending"}\n```')
    if (mode === 'prose') return content('Sure! Here you go: {"intent":"count"} hope that helps')
    if (mode === 'garbage') return content('I am not sure what you mean')
    if (mode === '401') return send(401, { error: 'invalid key' })
    if (mode === '500') return send(500, { error: 'boom' })
    if (mode === 'slow') return setTimeout(() => content('{}'), 1500)
    return send(404, {})
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

process.env.JWT_SECRET = 'unit-test'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = 'not-used-by-these-tests'
process.env.OLLAMA_URL = `http://127.0.0.1:${port}/api/chat`
process.env.OLLAMA_API_KEY = 'test-key'
process.env.OLLAMA_TIMEOUT_MS = '300'

const {
  normalizeFilter, matchesFilter, describeFilter, composeReply, createComplaintChatbot, todayIST, MAX_RESULTS,
} = await import('../src/services/complaintChatbot.service.js')
const { askOllamaForFilter, buildSystemPrompt } = await import('../src/services/ollama.service.js')
const { env } = await import('../src/config/env.js')

const quiet = async (fn) => { const orig = console.error; console.error = () => {}; try { return await fn() } finally { console.error = orig } }

// ============================ normalizeFilter ================================
test('categories: "streetlight" and friends map to the stored value "light" (the bug from the console script)', () => {
  for (const word of ['streetlight', 'Street Light', 'street_light', 'street-light', 'electricity', 'lamp', 'light']) {
    assert.equal(normalizeFilter({ category: word }).category, 'light', word)
  }
  assert.equal(normalizeFilter({ category: 'garbage' }).category, 'waste')
  assert.equal(normalizeFilter({ category: 'WATER' }).category, 'water')
})

test('an unknown category becomes a text search instead of silently returning nothing', () => {
  const f = normalizeFilter({ category: 'drainage' })
  assert.equal(f.category, undefined)
  assert.equal(f.textContains, 'drainage')
  // ...but an explicit textContains wins
  assert.equal(normalizeFilter({ category: 'drainage', textContains: 'blocked' }).textContains, 'blocked')
})

test('status wording maps to the five stored statuses; unknown statuses are dropped', () => {
  const map = { resolved: 'completed', done: 'completed', 'in progress': 'pending', in_progress: 'pending', new: 'submitted', approved: 'accepted', declined: 'rejected', Pending: 'pending' }
  for (const [word, expected] of Object.entries(map)) assert.equal(normalizeFilter({ status: word }).status, expected, word)
  assert.equal('status' in normalizeFilter({ status: 'banana' }), false)
})

test('complaint numbers are rebuilt into the canonical TVK_AZK_NNNN form', () => {
  for (const v of ['TVK_AZK_0011', 'tvkazk0011', 'AZK_0011', 'azk0011', '0011', '11', 'aak011', 11, 'TVK_AZK_11']) {
    assert.equal(normalizeFilter({ displayId: v }).displayId, 'TVK_AZK_0011', String(v))
  }
  assert.equal(normalizeFilter({ displayId: 'AAK001' }).displayId, 'TVK_AZK_0001')
  assert.equal('displayId' in normalizeFilter({ displayId: 'no digits here' }), false)
})

test('dates are validated, swapped if reversed, and impossible dates dropped', () => {
  assert.deepEqual(
    (({ fromDate, toDate }) => ({ fromDate, toDate }))(normalizeFilter({ fromDate: '2026-09-17', toDate: '2026-09-17' })),
    { fromDate: '2026-09-17', toDate: '2026-09-17' }
  )
  const swapped = normalizeFilter({ fromDate: '2026-09-20', toDate: '2026-09-10' })
  assert.equal(swapped.fromDate, '2026-09-10'); assert.equal(swapped.toDate, '2026-09-20')
  assert.equal('fromDate' in normalizeFilter({ fromDate: '2026-02-31' }), false)
  assert.equal('fromDate' in normalizeFilter({ fromDate: 'last week' }), false)
})

test('intent defaults to list; unknown keys and wrong types are ignored; junk input is safe', () => {
  assert.equal(normalizeFilter({}).intent, 'list')
  assert.equal(normalizeFilter({ intent: 'count' }).intent, 'count')
  assert.equal(normalizeFilter({ intent: 'delete everything' }).intent, 'list')
  const f = normalizeFilter({ hackerField: 'x', wardContains: 42, textContains: ['a'], userId: '  u1 ' })
  assert.deepEqual(f, { intent: 'list', userId: 'u1' })
  for (const junk of [null, undefined, 'a string', 5, [], [1, 2]]) assert.deepEqual(normalizeFilter(junk), { intent: 'list' })
  assert.equal(normalizeFilter({ wardContains: 'x'.repeat(500) }).wardContains.length, 100)
})

// ============================ matchesFilter ==================================
const row = (over) => ({ displayId: 'TVK_AZK_0001', title: 'Water problem', description: 'Water not coming', ward: '3rd ward , nearby pillayar Kovil Street', createdAt: new Date('2026-09-16T19:00:00Z'), ...over })

test('date filters use Indian time: 00:30 IST on the 17th counts as the 17th, 23:50 IST on the 16th does not', () => {
  const day17 = { fromDate: '2026-09-17', toDate: '2026-09-17' }
  assert.equal(matchesFilter(row({ createdAt: new Date('2026-09-16T19:00:00Z') }), day17), true)   // 17 Sep 00:30 IST
  assert.equal(matchesFilter(row({ createdAt: new Date('2026-09-16T18:20:00Z') }), day17), false)  // 16 Sep 23:50 IST
  assert.equal(matchesFilter(row({ createdAt: new Date('2026-09-17T18:25:00Z') }), day17), true)   // 17 Sep 23:55 IST
  assert.equal(matchesFilter(row({ createdAt: new Date('2026-09-17T18:45:00Z') }), day17), false)  // 18 Sep 00:15 IST
  assert.equal(matchesFilter(row({ createdAt: undefined }), day17), false)
})

test('todayIST: just after midnight in India is already the next day', () => {
  assert.equal(todayIST(Date.parse('2026-09-16T19:00:00Z')), '2026-09-17')
  assert.equal(todayIST(Date.parse('2026-09-16T10:00:00Z')), '2026-09-16')
})

test('ward and text filters are case-insensitive "contains", including Tamil text', () => {
  assert.equal(matchesFilter(row(), { wardContains: 'PILLAYAR' }), true)
  assert.equal(matchesFilter(row(), { wardContains: '9th ward' }), false)
  assert.equal(matchesFilter(row(), { textContains: 'not coming' }), true)
  assert.equal(matchesFilter(row({ title: 'சாலை', description: 'சாலை வசதி' }), { textContains: 'சாலை' }), true)
  assert.equal(matchesFilter(row(), { textContains: 'garbage' }), false)
})

// ============================ replies ========================================
test('reply wording', () => {
  assert.equal(composeReply({ intent: 'count', total: 14, shown: 0, filter: {} }), 'There are 14 complaints in total.')
  assert.equal(composeReply({ intent: 'count', total: 1, shown: 0, filter: { status: 'pending' } }), 'There is 1 complaint (status: Pending).')
  assert.equal(composeReply({ intent: 'list', total: 3, shown: 3, filter: { category: 'water' } }), 'Found 3 complaints (category: Water).')
  assert.equal(composeReply({ intent: 'list', total: 25, shown: 20, filter: {} }), 'Found 25 complaints. Showing the latest 20.')
  assert.equal(composeReply({ intent: 'list', total: 0, shown: 0, filter: { category: 'light' } }), 'No complaints found for category: Street light.')
  assert.equal(composeReply({ intent: 'list', total: 0, shown: 0, filter: {} }), 'No complaints found.')
  assert.deepEqual(describeFilter({ fromDate: '2026-09-17', toDate: '2026-09-17' }), ['created on 17 Sep 2026'])
  assert.deepEqual(describeFilter({ fromDate: '2026-09-01' }), ['created from 1 Sep 2026'])
  assert.equal(composeReply({ intent: 'list', total: 0, shown: 0, filter: { textContains: 'drainage' } }), 'No complaints found for text: “drainage”.')
  assert.deepEqual(describeFilter({ wardContains: '3rd ward' }), ['ward: “3rd ward”'])
})

// ============================ answer() =======================================
function makeBot(llmFilter, rows, users = new Map()) {
  const calls = { search: [], llm: [] }
  const bot = createComplaintChatbot({
    askLlmForFilter: async (q, opts) => { calls.llm.push({ q, opts }); if (llmFilter instanceof Error) throw llmFilter; return llmFilter },
    searchComplaints: async (f) => { calls.search.push(f); return rows },
    findUsersByIds: async () => users,
    now: () => Date.parse('2026-09-17T06:00:00Z'),
  })
  return { bot, calls }
}

const sample = [
  row({ displayId: 'TVK_AZK_0001', category: 'light', status: 'submitted', userId: 'u1', createdAt: new Date('2026-09-10T05:00:00Z') }),
  row({ displayId: 'TVK_AZK_0002', category: 'light', status: 'pending', userId: 'u2', createdAt: new Date('2026-09-12T05:00:00Z') }),
  row({ displayId: 'TVK_AZK_0003', category: 'water', status: 'completed', userId: 'u1', createdAt: new Date('2026-09-11T05:00:00Z') }),
]

test('the AI says "streetlight" -> the database is queried with "light", and results come back newest first with requester info', async () => {
  const users = new Map([['u1', { username: 'Karthik', mobile: '9876543210', passwordHash: 'SECRET' }]])
  const { bot, calls } = makeBot({ category: 'streetlight' }, sample.filter((r) => r.category === 'light'), users)
  const res = await bot.answer('complaint about street light')

  assert.equal(calls.search[0].category, 'light')
  assert.equal(calls.llm[0].opts.today, '2026-09-17')
  assert.equal(res.reply, 'Found 2 complaints (category: Street light).')
  assert.deepEqual(res.complaints.map((c) => c.id), ['TVK_AZK_0002', 'TVK_AZK_0001'])
  assert.equal(res.complaints[1].requester.username, 'Karthik')
  assert.equal(res.complaints[0].requester, null) // unknown user -> null, not a crash
  assert.equal(JSON.stringify(res).includes('SECRET'), false, 'never leaks fields beyond name + mobile')
  assert.deepEqual(res.summary.byStatus, { pending: 1, submitted: 1 })
  assert.equal(res.truncated, false)
})

test('"how many complaints are registered" answers with a count, not a dump of records', async () => {
  const { bot } = makeBot({ intent: 'count' }, sample)
  const res = await bot.answer('how many complaints are registered')
  assert.equal(res.reply, 'There are 3 complaints in total.')
  assert.deepEqual(res.complaints, [])
  assert.equal(res.total, 3)
  assert.deepEqual(res.summary.byStatus, { submitted: 1, pending: 1, completed: 1 })
})

test('a date question ("september 17") only returns complaints from that day in IST', async () => {
  const rows = [
    row({ displayId: 'TVK_AZK_0012', createdAt: new Date('2026-09-17T08:48:30Z') }), // 17 Sep 2:18 pm IST
    row({ displayId: 'TVK_AZK_0011', createdAt: new Date('2026-09-16T17:18:17Z') }), // 16 Sep 10:48 pm IST
  ]
  const { bot } = makeBot({ fromDate: '2026-09-17', toDate: '2026-09-17' }, rows)
  const res = await bot.answer('september 17 created complaints')
  assert.deepEqual(res.complaints.map((c) => c.id), ['TVK_AZK_0012'])
  assert.equal(res.reply, 'Found 1 complaint (created on 17 Sep 2026).')
})

test('complaint number typos still find the complaint; the Firestore query gets the canonical ID', async () => {
  const { bot, calls } = makeBot({ displayId: 'azk0011' }, [row({ displayId: 'TVK_AZK_0011' })])
  const res = await bot.answer('details of complaint azk0011')
  assert.equal(calls.search[0].displayId, 'TVK_AZK_0011')
  assert.equal(res.complaints.length, 1)
})

test('no matches, and more than 20 matches', async () => {
  const none = await makeBot({ status: 'completed' }, []).bot.answer('x')
  assert.equal(none.reply, 'No complaints found for status: Completed.')
  assert.deepEqual(none.complaints, [])

  const many = Array.from({ length: 25 }, (_, i) => row({ displayId: `TVK_AZK_${String(i + 1).padStart(4, '0')}`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) }))
  const res = await makeBot({}, many).bot.answer('all complaints')
  assert.equal(res.total, 25)
  assert.equal(res.complaints.length, MAX_RESULTS)
  assert.equal(res.truncated, true)
  assert.equal(res.complaints[0].id, 'TVK_AZK_0025') // newest first
  assert.match(res.reply, /Showing the latest 20\./)
})

test('long descriptions are shortened for the chat', async () => {
  const res = await makeBot({}, [row({ description: 'x'.repeat(400) })]).bot.answer('x')
  assert.equal(res.complaints[0].description.length, 161)
})

test('an AI failure is passed on untouched', async () => {
  const boom = Object.assign(new Error('down'), { code: 'CHATBOT_UNAVAILABLE' })
  await assert.rejects(makeBot(boom, []).bot.answer('x'), (e) => e.code === 'CHATBOT_UNAVAILABLE')
})

// ============================ the real Ollama client =========================
test('ollama client: sends the key, model, schema and a prompt with the real categories/statuses', async () => {
  mode = 'ok'; seen.length = 0
  const filter = await askOllamaForFilter('water complaints', { today: '2026-09-17' })
  assert.deepEqual(filter, { category: 'water' })
  const req = seen[0]
  assert.equal(req.headers.authorization, 'Bearer test-key')
  assert.equal(req.body.model, env.ollama.model)
  assert.equal(req.body.stream, false)
  assert.equal(req.body.options.temperature, 0)
  assert.equal(req.body.messages[1].content, 'water complaints')
  const prompt = req.body.messages[0].content
  assert.match(prompt, /2026-09-17/)
  for (const v of ['"road"', '"light"', '"water"', '"waste"', '"submitted"', '"pending"', '"completed"']) assert.ok(prompt.includes(v), v)
  assert.equal(prompt.includes('streetlight'), false, 'the prompt must not invite the model to invent categories')
  assert.equal(buildSystemPrompt('2030-01-01').includes('2030-01-01'), true)
})

test('ollama client: copes with ```json fences and with chatter around the JSON', async () => {
  mode = 'fenced'; assert.deepEqual(await askOllamaForFilter('q', { today: 'x' }), { status: 'pending' })
  mode = 'prose'; assert.deepEqual(await askOllamaForFilter('q', { today: 'x' }), { intent: 'count' })
})

test('ollama client: clear error codes for each failure', async () => {
  await quiet(async () => {
    const code = async (p) => { try { await p; return 'no error' } catch (e) { return `${e.code}/${e.statusCode}` } }
    mode = '401'; assert.equal(await code(askOllamaForFilter('q', { today: 'x' })), 'CHATBOT_AUTH_FAILED/502')
    mode = '500'; assert.equal(await code(askOllamaForFilter('q', { today: 'x' })), 'CHATBOT_UPSTREAM_ERROR/502')
    mode = 'garbage'; assert.equal(await code(askOllamaForFilter('q', { today: 'x' })), 'CHATBOT_BAD_RESPONSE/502')
    mode = 'slow'; assert.equal(await code(askOllamaForFilter('q', { today: 'x' })), 'CHATBOT_UNAVAILABLE/502') // 300ms timeout < 1500ms delay
    assert.equal(await code(askOllamaForFilter('q', { today: 'x', config: { ...env.ollama, url: 'http://127.0.0.1:1/x' } })), 'CHATBOT_UNAVAILABLE/502')
    assert.equal(await code(askOllamaForFilter('q', { today: 'x', config: { ...env.ollama, apiKey: '' } })), 'CHATBOT_NOT_CONFIGURED/503')
  })
})

test('ollama errors never echo the upstream response body to the caller', async () => {
  await quiet(async () => {
    mode = '401'
    try { await askOllamaForFilter('q', { today: 'x' }) } catch (e) { assert.equal(e.message.includes('invalid key'), false) }
  })
})

test.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref() })
