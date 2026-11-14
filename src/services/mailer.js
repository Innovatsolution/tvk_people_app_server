import { env } from '../config/env.js'

// An error from the HTTPS relay. `permanent` means "retrying won't help" (wrong secret, quota used up...).
function relayError(code, message, permanent = false) {
  return Object.assign(new Error(message), { code, permanent })
}

// ---- Optional fallback: HTTPS relay (a Google Apps Script on the Gmail account) ------
// For when you have no domain to verify in Resend. The server POSTs the email as JSON
// to the script's web-app URL; the script sends it from the Gmail account. Port 443 only.
function createRelayMailer(config, fetchImpl) {
  async function call(payload) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.relayTimeoutMs || 30000)
    let response
    try {
      // Google answers a script POST with a redirect to the result; fetch follows it.
      response = await fetchImpl(config.relayUrl, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: config.relaySecret, ...payload }),
      })
    } catch (err) {
      if (err?.name === 'AbortError') throw relayError('ETIMEDOUT', 'The Gmail relay took too long to answer')
      throw relayError('ECONNECTION', `Could not reach the Gmail relay (${err?.cause?.code || err?.message})`)
    } finally {
      clearTimeout(timer)
    }

    const body = await response.text()
    let data
    try {
      data = JSON.parse(body)
    } catch {
      // e.g. a Google sign-in page: the web app is not set to "Anyone", or the URL is wrong
      throw relayError('ERELAY_BAD_RESPONSE', `The Gmail relay URL did not answer like the script (HTTP ${response.status})`, true)
    }
    if (!data.ok) {
      const code = data.code === 'AUTH' ? 'ERELAY_AUTH' : data.code === 'QUOTA' ? 'ERELAY_QUOTA' : 'ERELAY'
      throw relayError(code, `Gmail relay refused: ${data.error || 'unknown error'}`, code !== 'ERELAY')
    }
    return data
  }

  return {
    enabled: config.enabled,
    to: config.to,
    notifyCitizen: config.notifyCitizen,
    via: 'Gmail relay (HTTPS)',
    config,
    // Asks the script to answer without sending anything. Resolves { ok, remaining } (recipients left today).
    verify: () => call({ action: 'ping' }),
    async send({ subject, text, html, attachments = [], to }) {
      const data = await call({
        action: 'send',
        to: to || config.to,
        subject,
        text,
        html,
        fromName: config.fromName,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          contentBase64: Buffer.from(a.content).toString('base64'),
        })),
      })
      return { remaining: data.remaining }
    },
  }
}

// ---- Resend (https://resend.com) - an email API over HTTPS (the default) ----------
// Plain HTTPS (port 443), so it works on any host, including Render's free plan. Resend only emails addresses other than the
// account owner's own once you have verified a domain you own, and `from` must be on that domain.
const RESEND_MIN_GAP_MS = 250 // Resend allows 5 requests a second; stay well under it

function resendError(status, data, retryAfter) {
  const name = String(data?.name || '')
  const message = String(data?.message || `HTTP ${status}`)
  const make = (code, permanent) => Object.assign(new Error(`Resend refused: ${message}`), { code, permanent, status, resendName: name })

  // A key that may only send mail is fine for sending (it just can't list domains) - not an error.
  if (status === 401 && name === 'restricted_api_key') return make('ERESEND_RESTRICTED', false)
  // Every way Resend says "this key is no good": missing, invalid (older and newer wording), not active, suspended.
  if (
    name === 'missing_api_key' ||
    name === 'invalid_api_key' ||
    name === 'suspended_api_key' ||
    name === 'restricted_api_key' || // 403 "API key is not active"
    /api key is (invalid|not active)|key is suspended/i.test(message)
  ) {
    return make('ERESEND_AUTH', true)
  }
  if (status === 403 && /testing emails to your own email/i.test(message)) {
    const owner = /\(([^)\s]+@[^)\s]+)\)/.exec(message)?.[1]
    return Object.assign(make('ERESEND_TEST_ONLY', true), { owner })
  }
  if (status === 403 && /domain/i.test(message) && /not verified/i.test(message)) return make('ERESEND_DOMAIN', true)
  if (status === 429 && /quota/i.test(name)) return make('ERESEND_QUOTA', true)
  if (status === 429) return Object.assign(make('ERESEND_RATE', false), { retryAfter })
  if (status === 409 && name === 'concurrent_idempotent_requests') return make('ERESEND_BUSY', false)
  if (status >= 500) return make('ERESEND_SERVER', false)
  return make('ERESEND_INVALID', true) // other 4xx: Resend did not like the request itself
}

function createResendMailer(config, fetchImpl) {
  const minGap = config.resendMinGapMs ?? RESEND_MIN_GAP_MS
  let chain = Promise.resolve()
  let nextAllowedAt = 0

  // One Resend call at a time, spaced out, so a burst (office email + citizen email) can't trip the rate limit.
  const paced = (fn) => {
    const run = chain.then(async () => {
      const wait = nextAllowedAt - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      nextAllowedAt = Date.now() + minGap
      return fn()
    })
    chain = run.catch(() => {})
    return run
  }

  async function call(method, path, body, extraHeaders = {}) {
    return paced(async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.resendTimeoutMs || 20000)
      let response
      try {
        response = await fetchImpl(`${config.resendApiUrl}${path}`, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'tvk-complaint-api/1.0',
            ...extraHeaders,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch (err) {
        if (err?.name === 'AbortError') throw Object.assign(new Error('Resend took too long to answer'), { code: 'ETIMEDOUT' })
        throw Object.assign(new Error(`Could not reach Resend (${err?.cause?.code || err?.message})`), { code: 'ECONNECTION' })
      } finally {
        clearTimeout(timer)
      }

      const text = await response.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { message: text.slice(0, 200) } }
      if (!response.ok) throw resendError(response.status, data, response.headers?.get?.('retry-after'))
      return data
    })
  }

  const addressOnly = (from) => (/<([^>]+)>/.exec(from)?.[1] || from).trim().toLowerCase()

  return {
    enabled: config.enabled,
    to: config.to,
    notifyCitizen: config.notifyCitizen,
    via: 'Resend (HTTPS)',
    config,
    // Resend has no "ping". Listing domains tells us the key works AND whether the sender domain is verified -
    // but only a full-access key may list domains; a sending-only key answers "restricted", which still proves it is valid.
    async verify() {
      const from = addressOnly(config.resendFrom)
      const domain = from.split('@')[1] || ''
      try {
        const data = await call('GET', '/domains')
        const found = (data.data || []).find((d) => String(d.name).toLowerCase() === domain)
        if (domain === 'resend.dev') {
          return {
            ok: true,
            warning:
              "RESEND_FROM is Resend's test sender (onboarding@resend.dev): Resend will only deliver to the email address of the Resend " +
              'account itself. To email the office addresses and customers, verify your own domain and set RESEND_FROM to an address on it.',
          }
        }
        if (!found) return { ok: true, warning: `The domain ${domain} (from RESEND_FROM) is not in your Resend account - add and verify it at resend.com/domains.` }
        if (found.status !== 'verified') return { ok: true, warning: `The domain ${domain} is "${found.status}" in Resend, not "verified" yet - finish the DNS records at resend.com/domains.` }
        return { ok: true, summary: `API key accepted; sender domain ${domain} is verified` }
      } catch (err) {
        if (err.code === 'ERESEND_RESTRICTED') {
          return {
            ok: true,
            summary: 'API key accepted (a sending-only key, so the sender domain status cannot be checked)',
            ...(domain === 'resend.dev'
              ? { warning: "RESEND_FROM is Resend's test sender (onboarding@resend.dev): it only delivers to the Resend account's own address. Verify your own domain to email anyone else." }
              : {}),
          }
        }
        throw err
      }
    },
    async send({ subject, text, html, attachments = [], to, idempotencyKey }) {
      const recipients = String(to || config.to).split(',').map((a) => a.trim()).filter(Boolean)
      const data = await call(
        'POST',
        '/emails',
        {
          from: config.resendFrom,
          to: recipients,
          subject,
          text,
          html,
          attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
        },
        // Same key on every retry of ONE send: if Resend got the email but the reply was lost, the retry cannot send a duplicate.
        idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey).slice(0, 256) } : {}
      )
      return { id: data.id }
    },
  }
}

// Resend is the default sender; MAIL_TRANSPORT=relay selects the optional Gmail relay.
// `config` and `fetchImpl` can be replaced in tests.
export function createMailer(config = env.mail, fetchImpl = fetch) {
  return config.transport === 'relay' ? createRelayMailer(config, fetchImpl) : createResendMailer(config, fetchImpl)
}

// Turns a mail error into "what to do about it", in plain words (empty string if unknown).
export function explainMailError(err, config = env.mail) {
  const text = `${err?.response || ''} ${err?.message || ''}`
  const code = err?.code

  // ---- Resend problems
  if (code === 'ERESEND_AUTH') {
    return (
      'Resend rejected the API key: copy it again from resend.com/api-keys into RESEND_API_KEY (it starts with re_), with no spaces or quotes. ' +
      'If you copied it correctly, the key may have been deleted or suspended - create a new one.'
    )
  }
  if (code === 'ERESEND_TEST_ONLY') {
    return (
      "Resend's test sender (onboarding@resend.dev) may only email the Resend account's own address" +
      `${err.owner ? ` (${err.owner})` : ''}. To email the office addresses and customers, verify a domain you own at ` +
      'resend.com/domains and set RESEND_FROM to an address on it, e.g. RESEND_FROM=TVK Complaints <complaints@yourdomain.com>.'
    )
  }
  if (code === 'ERESEND_DOMAIN') {
    return (
      'The domain in RESEND_FROM is not verified in Resend. Add the DNS records Resend shows at resend.com/domains and wait until it says ' +
      'Verified, or change RESEND_FROM to an address on a domain that is already verified.'
    )
  }
  if (code === 'ERESEND_QUOTA') {
    return (
      "Resend's sending limit for your plan is used up (free plan: 100 emails a day, 3,000 a month; each recipient of an email counts as one). " +
      'The daily limit resets at midnight UTC, or you can upgrade the Resend plan.'
    )
  }
  if (code === 'ERESEND_RATE') return 'Resend says we are sending too fast - the server retries automatically.'
  if (code === 'ERESEND_INVALID') {
    return `Resend did not accept the email (${String(err.message).replace(/^Resend refused: /, '')}). Check RESEND_FROM and the addresses in MAIL_TO.`
  }
  if (config?.transport === 'resend' && ['ETIMEDOUT', 'ECONNECTION'].includes(code)) {
    return "Could not reach api.resend.com - check the server's internet access."
  }

  // ---- HTTPS relay problems
  if (code === 'ERELAY_AUTH') {
    return (
      'The relay rejected the secret: MAIL_RELAY_SECRET must be exactly the same text as SECRET inside the Apps Script ' +
      '(then save the script and deploy a new version).'
    )
  }
  if (code === 'ERELAY_QUOTA') {
    return (
      "Google's daily email limit for this Gmail account (100 recipients a day) has been used up - sending resumes within 24 hours. " +
      'To avoid it, list fewer addresses in MAIL_TO, or switch to Resend (leave MAIL_TRANSPORT unset and set RESEND_API_KEY).'
    )
  }
  if (code === 'ERELAY_BAD_RESPONSE') {
    return (
      'MAIL_RELAY_URL did not answer like the script. Check it is the Web app URL ending in /exec, and that the deployment was ' +
      'made with "Execute as: Me" and "Who has access: Anyone".'
    )
  }
  if (config?.transport === 'relay' && ['ETIMEDOUT', 'ECONNECTION'].includes(code)) {
    return 'Could not reach script.google.com - check the server\'s internet access and that MAIL_RELAY_URL is correct.'
  }

  // anything else (e.g. a failure that is not specific to the mail service) has no special advice
  return ''
}
