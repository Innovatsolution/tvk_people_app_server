// Run with: npm run test:resend
// Tests sending the complaint emails through Resend's HTTPS API. The fake Resend below enforces
// Resend's real rules (documented at resend.com/docs): the test sender may only email the account
// owner, the From domain must be verified, quotas, 5 requests a second, idempotency keys,
// sending-only API keys - so the problems you could hit in real life are reproduced here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'

process.chdir(os.tmpdir()) // never read a developer's real .env
process.env.JWT_SECRET = 'unit-test'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = 'not-used-by-these-tests'
for (const k of ['SMTP_USER', 'SMTP_PASS', 'MAIL_TO', 'MAIL_TRANSPORT', 'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_API_URL', 'MAIL_FROM', 'NOTIFY_CITIZEN', 'RENDER']) delete process.env[k]

const { createMailer, explainMailError } = await import('../src/services/mailer.js')
const { createComplaintNotifier } = await import('../src/services/complaintNotifier.js')

const FULL_KEY = 're_fullAccessKey1234567890'
const SEND_ONLY_KEY = 're_sendingOnlyKey1234567890'
const OWNER = 'owner@example.com'

// ---- a fake Resend -------------------------------------------------------------
let delivered, idempotent, stamps, domains, quotaLeft, mode, dropped, lastRequest
const reset = () => {
  delivered = []; idempotent = new Map(); stamps = []; quotaLeft = 100; mode = 'normal'; dropped = false; lastRequest = null
  domains = [{ name: 'tvk-demo.org', status: 'verified' }]
}
reset()

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    const err = (status, name, message) => send(status, { statusCode: status, name, message })
    lastRequest = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined }

    const key = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!req.headers.authorization) return err(401, 'missing_api_key', 'Missing API key in the authorization header.')
    if (![FULL_KEY, SEND_ONLY_KEY].includes(key)) return err(403, 'invalid_api_key', 'API key is invalid.')

    if (req.method === 'GET' && req.url === '/domains') {
      if (key === SEND_ONLY_KEY) return err(401, 'restricted_api_key', 'This API key is restricted to only send emails.')
      return send(200, { object: 'list', data: domains })
    }

    if (req.method === 'POST' && req.url === '/emails') {
      if (mode === 'server-error') return err(500, 'internal_server_error', 'Something went wrong')
      const body = lastRequest.body
      const idem = req.headers['idempotency-key']
      if (idem && idempotent.has(idem)) return send(200, { id: idempotent.get(idem) }) // same key -> same answer, nothing re-sent

      stamps = stamps.filter((t) => Date.now() - t < 1000); stamps.push(Date.now())
      if (stamps.length > 5) return err(429, 'rate_limit_exceeded', 'Too many requests. Please limit the number of requests per second.')
      if (!body.from || !Array.isArray(body.to) || !body.to.length || !body.subject) return err(422, 'missing_required_field', 'The request body is missing one or more required fields.')
      if (body.to.some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))) return err(422, 'validation_error', 'Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.')

      const fromAddr = (/<([^>]+)>/.exec(body.from)?.[1] || body.from).toLowerCase()
      const fromDomain = fromAddr.split('@')[1]
      if (fromDomain === 'resend.dev') {
        if (body.to.some((a) => a.toLowerCase() !== OWNER)) return err(403, 'validation_error', `You can only send testing emails to your own email address (${OWNER}). To send emails to other recipients, please verify a domain at resend.com/domains, and change the \`from\` address to an email using this domain.`)
      } else if (!domains.some((d) => d.name === fromDomain && d.status === 'verified')) {
        return err(403, 'validation_error', `The ${fromDomain} domain is not verified. Please, add and verify your domain on https://resend.com/domains`)
      }
      if (quotaLeft <= 0) return err(429, 'daily_quota_exceeded', 'You have reached your daily email quota.')
      quotaLeft -= 1

      const id = `id-${delivered.length + 1}`
      delivered.push({ id, ...body, attachments: (body.attachments || []).map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content, 'base64') })) })
      if (idem) idempotent.set(idem, id)
      if (mode === 'drop-once' && !dropped) { dropped = true; return req.socket.destroy() } // accepted, but the reply never arrives
      if (mode === 'slow') return setTimeout(() => send(200, { id }), 1500)
      return send(200, { id })
    }
    err(404, 'not_found', 'The requested endpoint does not exist.')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

const config = (over = {}) => ({
  transport: 'resend', resendApiKey: FULL_KEY, resendFrom: 'TVK Complaints <complaints@tvk-demo.org>', resendApiUrl: BASE,
  resendTimeoutMs: 700, resendMinGapMs: 0, to: 'office@example.com, mkumarazk@gmail.com', notifyCitizen: true, enabled: true, ...over,
})
const failsWith = async (p) => { try { await p } catch (e) { return e } assert.fail('expected an error') }
const photo = Buffer.from('fake-jpeg-bytes-\x00\x01\xff')
const msg = (over = {}) => ({ subject: 'Hello ஜோ', text: 'plain ஜோ', html: '<p>html</p>', attachments: [{ filename: 'a-before.jpg', content: photo, contentType: 'image/jpeg' }], ...over })

// ============================ sending ========================================
test('send: the right JSON goes to POST /emails - sender, both office addresses as an array, text, html, photo as base64', async () => {
  reset()
  const out = await createMailer(config()).send(msg({ idempotencyKey: 'key-1' }))
  assert.equal(out.id, 'id-1')
  const { method, url, headers, body } = lastRequest
  assert.equal(method, 'POST'); assert.equal(url, '/emails')
  assert.equal(headers.authorization, `Bearer ${FULL_KEY}`)
  assert.match(headers['content-type'], /application\/json/)
  assert.equal(headers['idempotency-key'], 'key-1')
  assert.deepEqual(body.to, ['office@example.com', 'mkumarazk@gmail.com'])
  assert.equal(body.from, 'TVK Complaints <complaints@tvk-demo.org>')
  assert.equal(body.subject, 'Hello ஜோ'); assert.equal(body.text, 'plain ஜோ'); assert.equal(body.html, '<p>html</p>')
  assert.ok(delivered[0].attachments[0].bytes.equals(photo), 'photo bytes survive unchanged')
  assert.equal(delivered[0].attachments[0].filename, 'a-before.jpg')
})

test('send: a different recipient (the citizen) replaces the office list', async () => {
  reset()
  await createMailer(config()).send(msg({ to: 'citizen@example.com' }))
  assert.deepEqual(lastRequest.body.to, ['citizen@example.com'])
})

// ============================ startup check ==================================
test('verify: a full-access key + verified sender domain -> a clear OK', async () => {
  reset()
  const r = await createMailer(config()).verify()
  assert.match(r.summary, /sender domain tvk-demo\.org is verified/)
  assert.equal(r.warning, undefined)
  assert.equal(lastRequest.url, '/domains')
})

test('verify: a sending-only key is accepted (it can send, it just cannot list domains)', async () => {
  reset()
  const r = await createMailer(config({ resendApiKey: SEND_ONLY_KEY })).verify()
  assert.match(r.summary, /sending-only key/)
  assert.equal(r.warning, undefined)
})

test('verify: warns when the sender domain is still pending, or not in the account at all', async () => {
  reset(); domains = [{ name: 'tvk-demo.org', status: 'pending' }]
  assert.match((await createMailer(config()).verify()).warning, /"pending".*finish the DNS records/)
  domains = []
  assert.match((await createMailer(config()).verify()).warning, /not in your Resend account/)
})

test("verify: Resend's test sender gets a loud warning that only the account owner can receive mail", async () => {
  reset()
  const testFrom = 'TVK Complaints <onboarding@resend.dev>'
  for (const key of [FULL_KEY, SEND_ONLY_KEY]) {
    const r = await createMailer(config({ resendFrom: testFrom, resendApiKey: key })).verify()
    assert.match(r.warning, /test sender/)
    assert.match(r.warning, /account itself|account's own address/)
  }
})

test('verify: a wrong or missing key -> ERESEND_AUTH, and the advice says where to copy it from', async () => {
  reset()
  const wrong = await failsWith(createMailer(config({ resendApiKey: 're_wrongwrongwrong' })).verify())
  assert.equal(wrong.code, 'ERESEND_AUTH'); assert.equal(wrong.permanent, true)
  assert.match(explainMailError(wrong, config()), /resend\.com\/api-keys/)
})

// ============================ Resend's rules, as errors ======================
test("the 'only your own address' rule (no verified domain yet) is recognised, names the owner, and explains the fix", async () => {
  reset()
  const testCfg = config({ resendFrom: 'TVK Complaints <onboarding@resend.dev>' })
  await createMailer(testCfg).send(msg({ to: OWNER })) // the account owner: allowed
  const err = await failsWith(createMailer(testCfg).send(msg())) // office list: refused
  assert.equal(err.code, 'ERESEND_TEST_ONLY'); assert.equal(err.permanent, true); assert.equal(err.owner, OWNER)
  const advice = explainMailError(err, testCfg)
  assert.match(advice, new RegExp(OWNER.replace('.', '\\.')))
  assert.match(advice, /verify a domain/); assert.match(advice, /RESEND_FROM/)
})

test('a From domain that is not verified -> ERESEND_DOMAIN with DNS advice', async () => {
  reset()
  const err = await failsWith(createMailer(config({ resendFrom: 'TVK <complaints@not-verified.org>' })).send(msg()))
  assert.equal(err.code, 'ERESEND_DOMAIN'); assert.equal(err.permanent, true)
  assert.match(explainMailError(err, config()), /DNS records/)
})

test('plan limit used up -> ERESEND_QUOTA (permanent), advice quotes the free-plan numbers', async () => {
  reset(); quotaLeft = 0
  const err = await failsWith(createMailer(config()).send(msg()))
  assert.equal(err.code, 'ERESEND_QUOTA'); assert.equal(err.permanent, true)
  assert.match(explainMailError(err, config()), /100 emails a day/)
})

test('an address Resend rejects -> ERESEND_INVALID (permanent) pointing at MAIL_TO / RESEND_FROM', async () => {
  reset()
  const err = await failsWith(createMailer(config({ to: 'not-an-email' })).send(msg()))
  assert.equal(err.code, 'ERESEND_INVALID'); assert.equal(err.permanent, true)
  assert.match(explainMailError(err, config()), /MAIL_TO/)
})

test('temporary problems are retryable: Resend 5xx, nothing listening, too slow', async () => {
  reset(); mode = 'server-error'
  const e500 = await failsWith(createMailer(config()).send(msg()))
  assert.equal(e500.code, 'ERESEND_SERVER'); assert.equal(e500.permanent, false)

  const down = await failsWith(createMailer(config({ resendApiUrl: 'http://127.0.0.1:1' })).send(msg()))
  assert.equal(down.code, 'ECONNECTION'); assert.match(explainMailError(down, config()), /api\.resend\.com/)

  reset(); mode = 'slow'
  const slow = await failsWith(createMailer(config()).send(msg()))
  assert.equal(slow.code, 'ETIMEDOUT')
  mode = 'normal'
})

test('the API key never appears in an error message or its advice', async () => {
  reset(); quotaLeft = 0
  const err = await failsWith(createMailer(config()).send(msg()))
  assert.equal(`${err.message} ${explainMailError(err, config())}`.includes(FULL_KEY), false)
})

// ============================ newer Resend error shapes ======================
// Resend's current docs describe a bad key as validation_error "API key is invalid" (HTTP 401 when sending,
// 400 elsewhere), and an inactive/suspended key as 403. These must read as "bad key", not "bad email".
const stubResponse = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('a bad API key in Resend\'s newer wording is recognised as a key problem (sending: 401, other calls: 400, inactive: 403, suspended: 403)', async () => {
  const cases = [
    ['401 send', 'send', 401, { statusCode: 401, name: 'validation_error', message: 'API key is invalid' }],
    ['400 verify', 'verify', 400, { statusCode: 400, name: 'validation_error', message: 'API key is invalid' }],
    ['403 not active', 'send', 403, { statusCode: 403, name: 'restricted_api_key', message: 'API key is not active' }],
    ['403 suspended', 'send', 403, { statusCode: 403, name: 'suspended_api_key', message: 'This API key is suspended' }],
  ]
  for (const [label, op, status, body] of cases) {
    const mailer = createMailer(config(), stubResponse(status, body))
    const err = await failsWith(op === 'send' ? mailer.send(msg()) : mailer.verify())
    assert.equal(err.code, 'ERESEND_AUTH', label)
    assert.equal(err.permanent, true, label)
    assert.match(explainMailError(err, config()), /resend\.com\/api-keys/, label)
  }
})

test('ordinary validation problems are still "bad request" - not mistaken for a bad key', async () => {
  const mailer = createMailer(config(), stubResponse(400, { statusCode: 400, name: 'validation_error', message: 'Invalid `to` field.' }))
  const err = await failsWith(mailer.send(msg()))
  assert.equal(err.code, 'ERESEND_INVALID')
})

test('a send-only key reading "restricted to only send emails" is still accepted by verify()', async () => {
  const mailer = createMailer(config(), stubResponse(401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' }))
  const r = await mailer.verify()
  assert.match(r.summary, /sending-only key/)
})

test('plan-limit advice tells you each recipient counts and when the daily limit resets', () => {
  const advice = explainMailError(Object.assign(new Error('x'), { code: 'ERESEND_QUOTA' }), config())
  assert.match(advice, /100 emails a day/)
  assert.match(advice, /each recipient/)
  assert.match(advice, /midnight UTC/)
})

// ============================ pacing =========================================
test('pacing: back-to-back sends are spaced out, so the 5-requests-a-second limit is never hit (and would be without pacing)', async () => {
  reset()
  const paced = createMailer(config({ resendMinGapMs: 220 }))
  for (let i = 0; i < 7; i += 1) await paced.send(msg({ subject: `paced ${i}` })) // would be 7 in ~0s without pacing
  assert.equal(delivered.length, 7, 'all 7 delivered, none rate-limited')

  reset()
  const burst = createMailer(config({ resendMinGapMs: 0 }))
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => burst.send(msg({ subject: `burst ${i}` }))))
  const limited = results.filter((r) => r.status === 'rejected' && r.reason.code === 'ERESEND_RATE')
  assert.ok(limited.length >= 1, 'without pacing the fake Resend does rate-limit a burst')
  assert.equal(limited[0].reason.permanent, false, 'and that error is retryable')
})

// ============================ the notifier on top of Resend ==================
const silent = () => { const calls = { log: [], warn: [], error: [] }; return { calls, log: { log: (...a) => calls.log.push(a.join(' ')), warn: (...a) => calls.warn.push(a.join(' ')), error: (...a) => calls.error.push(a.join(' ')) } } }
const complaint = { displayId: 'TVK_AZK_0011', userId: 'u1', category: 'water', title: 'Water problem', description: 'No water', ward: '3rd ward', status: 'accepted', createdAt: new Date('2026-09-16T17:18:17Z'), beforeImageBase64: `data:image/jpeg;base64,${photo.toString('base64')}` }
const args = (email) => ({ complaint, requester: { username: 'Selvi', mobile: '9876543210', email }, stage: 'accepted', previousStatus: 'submitted', changedBy: { username: 'Admin' } })

test('notifier + Resend: the office pair and the citizen each get their own email with the photo', async () => {
  reset(); const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: createMailer(config()), log, retryDelaysMs: [] })
  assert.equal(await notify(args('Citizen@Example.com')), true)
  assert.deepEqual(delivered.map((d) => d.to), [['office@example.com', 'mkumarazk@gmail.com'], ['citizen@example.com']])
  for (const d of delivered) {
    assert.equal(d.subject, '[TVK Complaint] TVK_AZK_0011 – Accepted: Water problem')
    assert.equal(d.attachments.length, 1)
    assert.ok(d.text.includes('Stage: Submitted → Accepted'))
  }
})

test('notifier + Resend: if Resend gets the email but the reply is lost, the retry does NOT send it twice', async () => {
  reset(); mode = 'drop-once'
  const { log } = silent(); const waits = []
  const { notify } = createComplaintNotifier({ mailer: createMailer(config()), log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args(null)), true)
  assert.deepEqual(waits, [2000], 'one retry after the lost reply')
  assert.equal(delivered.length, 1, 'delivered exactly once')
})

test('notifier + Resend: the rate-limit (429) is retried and then succeeds', async () => {
  reset(); const { log } = silent(); const waits = []
  const realFetch = globalThis.fetch
  let calls = 0
  const flaky = async (...a) => (++calls === 1
    ? new Response(JSON.stringify({ statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' }), { status: 429 })
    : realFetch(...a))
  const { notify } = createComplaintNotifier({ mailer: createMailer(config(), flaky), log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args(null)), true)
  assert.deepEqual(waits, [2000])
  assert.equal(delivered.length, 1)
})

test('notifier + Resend: no verified domain yet -> reported ONCE with the fix, not retried, and the key is not logged', async () => {
  reset(); const { calls, log } = silent(); const waits = []
  const mailer = createMailer(config({ resendFrom: 'TVK Complaints <onboarding@resend.dev>' }))
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args('citizen@example.com')), false)
  assert.deepEqual(waits, [], 'permanent errors are not retried')
  assert.ok(calls.error.length >= 1)
  assert.match(calls.error[0], /verify a domain/)
  assert.match(calls.error.join(' '), /RESEND_FROM/)
  assert.equal(calls.error.join(' ').includes(FULL_KEY), false)
  assert.equal(delivered.length, 0)
})

test('NO-DOMAIN setup from the README works: test sender + MAIL_TO = the Resend account\'s own address + NOTIFY_CITIZEN=false', async () => {
  reset(); const { calls, log } = silent()
  const cfg = config({ resendFrom: 'TVK Complaints <onboarding@resend.dev>', to: OWNER, notifyCitizen: false })
  const { notify } = createComplaintNotifier({ mailer: createMailer(cfg), log, retryDelaysMs: [] })
  assert.equal(await notify(args('citizen@example.com')), true)
  assert.deepEqual(delivered.map((d) => d.to), [[OWNER]], 'one email, to the account owner only - nothing attempted for the citizen')
  assert.equal(calls.error.length, 0)
  // ...and the same setup WITH the office addresses (what the screenshot-style example cannot do) is refused:
  reset()
  const wrong = createComplaintNotifier({ mailer: createMailer(config({ resendFrom: 'TVK Complaints <onboarding@resend.dev>' })), log: silent().log, retryDelaysMs: [] })
  assert.equal(await wrong.notify(args(null)), false)
  assert.equal(delivered.length, 0)
})

// ============================ configuration ==================================
test('config: Resend is the default transport; it needs RESEND_API_KEY and a MAIL_TO; sensible defaults', async () => {
  const load = async (vars, tag) => {
    const saved = {}
    for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
    try { return (await import(`../src/config/env.js?${tag}`)).env.mail } finally { for (const k of Object.keys(vars)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]) }
  }
  const def = await load({ RESEND_API_KEY: 're_abc1234567890', MAIL_TO: 'a@x.com' }, 'rs-default')
  assert.equal(def.transport, 'resend', 'no MAIL_TRANSPORT needed')
  assert.equal(def.enabled, true)

  const ok = await load({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: '  re_abc1234567890  ', MAIL_TO: 'a@x.com, b@y.com' }, 'rs-ok')
  assert.equal(ok.transport, 'resend'); assert.equal(ok.enabled, true)
  assert.equal(ok.resendApiKey, 're_abc1234567890', 'surrounding spaces are trimmed')
  assert.equal(ok.resendFrom, 'TVK Complaints <onboarding@resend.dev>', 'defaults to the TEST sender until you set your own domain')
  assert.equal(ok.to, 'a@x.com, b@y.com')

  const custom = await load({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_abc1234567890', MAIL_TO: 'a@x.com', RESEND_FROM: 'TVK <complaints@tvk-demo.org>', RESEND_API_URL: 'https://example.test/' }, 'rs-custom')
  assert.equal(custom.resendFrom, 'TVK <complaints@tvk-demo.org>')
  assert.equal(custom.resendApiUrl, 'https://example.test', 'trailing slash removed')

  assert.equal((await load({ MAIL_TRANSPORT: 'resend', MAIL_TO: 'a@x.com' }, 'rs-nokey')).enabled, false, 'no key')
  assert.equal((await load({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_abc1234567890' }, 'rs-noto')).enabled, false, 'no recipients')
})

test.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref() })
