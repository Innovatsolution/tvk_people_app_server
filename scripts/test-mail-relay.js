// Run with: npm run test:relay
// Tests the HTTPS Gmail relay (for hosts that block SMTP, e.g. Render's free plan).
// The fake "Google" runs the REAL scripts/gmail-relay.gs file with Google's mail services stubbed,
// and answers a POST the way Google does - with a redirect to the result - so what is checked here
// is the script you actually paste into Google, plus the server code that talks to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import vm from 'node:vm'
import fs from 'node:fs'
import os from 'node:os'

process.chdir(os.tmpdir()) // never read a developer's real .env
process.env.JWT_SECRET = 'unit-test'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = 'not-used-by-these-tests'
for (const k of ['SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'MAIL_TO', 'MAIL_TRANSPORT', 'MAIL_RELAY_URL', 'MAIL_RELAY_SECRET', 'NOTIFY_CITIZEN', 'RENDER']) delete process.env[k]

const { createMailer, explainMailError } = await import('../src/services/mailer.js')
const { createComplaintNotifier, buildComplaintEmail } = await import('../src/services/complaintNotifier.js')

const SCRIPT_FILE = new URL('./gmail-relay.gs', import.meta.url)
const RAW_SCRIPT = fs.readFileSync(SCRIPT_FILE, 'utf8')
const SECRET = 'a-long-random-secret-for-the-tests'
const SCRIPT = RAW_SCRIPT.replace("'CHANGE-ME-to-a-long-random-text'", `'${SECRET}'`)
assert.notEqual(SCRIPT, RAW_SCRIPT, 'the placeholder secret line was found and replaced')

// ---- Google's services, stubbed ------------------------------------------------
function loadScript(source, quota = 100) {
  const sent = []
  let remaining = quota
  const ctx = {
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this } }) },
    Utilities: { base64Decode: (s) => [...Buffer.from(s, 'base64')], newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    MailApp: {
      sendEmail(options) {
        const recipients = String(options.to).split(',').filter(Boolean).length
        if (recipients > remaining) throw new Error('Service invoked too many times for one day: email.')
        remaining -= recipients
        sent.push(options)
      },
      getRemainingDailyQuota: () => remaining,
    },
    Logger: { log() {} },
  }
  vm.createContext(ctx)
  vm.runInContext(source, ctx)
  return { ctx, sent, remaining: () => remaining }
}

// ---- ...and Google's web-app front door: POST -> 302 -> GET the result ---------
let script = loadScript(SCRIPT)
let mode = 'normal'
const results = new Map()
let counter = 0
const server = http.createServer((req, res) => {
  const finish = (out) => {
    const id = ++counter
    results.set(id, out)
    res.writeHead(302, { Location: `/macros/echo/${id}` })
    res.end()
  }
  if (req.method === 'POST' && req.url === '/macros/s/TESTID/exec') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const run = () => finish(mode === 'login-page' ? '<html><body>Sign in - Google Accounts</body></html>' : script.ctx.doPost({ postData: { contents: body } }).text)
      mode === 'slow' ? setTimeout(run, 1500) : run()
    })
  } else if (req.method === 'GET' && req.url.startsWith('/macros/echo/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(results.get(Number(req.url.split('/').pop())))
  } else if (req.method === 'GET' && req.url === '/macros/s/TESTID/exec') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(script.ctx.doGet().text)
  } else { res.writeHead(404); res.end('not found') }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`
const URL_OK = `${BASE}/macros/s/TESTID/exec`

const config = (over = {}) => ({
  transport: 'relay', relayUrl: URL_OK, relaySecret: SECRET, relayTimeoutMs: 800, fromName: 'TVK Complaints',
  to: 'office@example.com, mkumarazk@gmail.com', notifyCitizen: true, enabled: true, ...over,
})
const reset = (quota = 100) => { mode = 'normal'; script = loadScript(SCRIPT, quota) }
const failsWith = async (promise) => { try { await promise } catch (e) { return e } assert.fail('expected an error') }
const photo = Buffer.from('fake-jpeg-bytes-\x00\x01\x02\xff')

// ============================ the Apps Script itself =========================
test('the script: a browser visit to the URL shows a harmless health message', () => {
  reset()
  assert.equal(JSON.parse(script.ctx.doGet().text).message, 'TVK Gmail relay is running')
})

test('the script: refuses to run until SECRET has been changed from the placeholder', () => {
  const fresh = loadScript(RAW_SCRIPT)
  const out = JSON.parse(fresh.ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'CHANGE-ME-to-a-long-random-text', action: 'ping' }) } }).text)
  assert.equal(out.ok, false)
  assert.match(out.error, /SECRET has not been set/)
  assert.equal(fresh.sent.length, 0)
})

test('the script: a wrong secret, junk JSON and a missing recipient send nothing', () => {
  reset()
  const call = (contents) => JSON.parse(script.ctx.doPost({ postData: { contents } }).text)
  assert.deepEqual(call(JSON.stringify({ secret: 'wrong', action: 'send', to: 'a@b.com', subject: 's' })), { ok: false, code: 'AUTH', error: 'Wrong secret' })
  assert.equal(call('not json at all').ok, false)
  assert.equal(call(JSON.stringify({ secret: SECRET, action: 'send', subject: 's' })).ok, false)
  assert.equal(script.sent.length, 0)
})

// ============================ the server's relay client ======================
test('relay mailer: verify() reaches the script (following Google\'s redirect) and reports the quota left', async () => {
  reset()
  const result = await createMailer(config()).verify()
  assert.deepEqual(result, { ok: true, remaining: 100 })
  assert.equal(script.sent.length, 0, 'a ping sends no email')
})

test('relay mailer: send() delivers subject, text, html, sender name and photos intact', async () => {
  reset()
  const mailer = createMailer(config())
  const out = await mailer.send({
    subject: '[TVK Complaint] TVK_AZK_0011 – Accepted: Water problem',
    text: 'plain text ஜோ',
    html: '<p>html ஜோ</p>',
    attachments: [{ filename: 'TVK_AZK_0011-before.jpg', content: photo, contentType: 'image/jpeg' }],
  })
  assert.equal(script.sent.length, 1)
  const mail = script.sent[0]
  assert.equal(mail.to, 'office@example.com, mkumarazk@gmail.com', 'goes to the MAIL_TO list')
  assert.equal(mail.subject, '[TVK Complaint] TVK_AZK_0011 – Accepted: Water problem')
  assert.equal(mail.body, 'plain text ஜோ')
  assert.equal(mail.htmlBody, '<p>html ஜோ</p>')
  assert.equal(mail.name, 'TVK Complaints')
  assert.equal(mail.attachments.length, 1)
  assert.equal(mail.attachments[0].name, 'TVK_AZK_0011-before.jpg')
  assert.equal(mail.attachments[0].type, 'image/jpeg')
  assert.ok(Buffer.from(mail.attachments[0].bytes).equals(photo), 'photo bytes survive the trip unchanged')
  assert.equal(out.remaining, 98, 'two office recipients used 2 of the 100')
})

test('relay mailer: a different recipient (the citizen) overrides the office list', async () => {
  reset()
  await createMailer(config()).send({ subject: 's', text: 't', to: 'citizen@example.com' })
  assert.equal(script.sent[0].to, 'citizen@example.com')
})

test('relay errors: wrong secret -> ERELAY_AUTH (permanent) with a fix that names MAIL_RELAY_SECRET; the secret is never in the message', async () => {
  reset()
  const err = await failsWith(createMailer(config({ relaySecret: 'not-the-secret' })).send({ subject: 's', text: 't' }))
  assert.equal(err.code, 'ERELAY_AUTH')
  assert.equal(err.permanent, true)
  assert.match(explainMailError(err, config()), /MAIL_RELAY_SECRET/)
  assert.equal(`${err.message} ${explainMailError(err, config())}`.includes(SECRET), false)
  assert.equal(script.sent.length, 0)
})

test('relay errors: Google\'s daily limit -> ERELAY_QUOTA (permanent) with plain advice', async () => {
  reset(1) // one recipient left; the office list has two
  const err = await failsWith(createMailer(config()).send({ subject: 's', text: 't' }))
  assert.equal(err.code, 'ERELAY_QUOTA')
  assert.equal(err.permanent, true)
  assert.match(explainMailError(err, config()), /100 recipients a day/)
})

test('relay errors: a Google sign-in page instead of the script -> ERELAY_BAD_RESPONSE, advice mentions /exec and "Anyone"', async () => {
  reset(); mode = 'login-page'
  const err = await failsWith(createMailer(config()).verify())
  assert.equal(err.code, 'ERELAY_BAD_RESPONSE')
  assert.equal(err.permanent, true)
  const advice = explainMailError(err, config())
  assert.match(advice, /\/exec/)
  assert.match(advice, /Anyone/)
})

test('relay errors: nothing listening, and a script that is too slow, are temporary (retryable) failures', async () => {
  reset()
  const down = await failsWith(createMailer(config({ relayUrl: 'http://127.0.0.1:1/macros/s/X/exec' })).verify())
  assert.equal(down.code, 'ECONNECTION')
  assert.notEqual(down.permanent, true)
  assert.match(explainMailError(down, config()), /script\.google\.com/)

  mode = 'slow'
  const slow = await failsWith(createMailer(config()).verify())
  assert.equal(slow.code, 'ETIMEDOUT')
  assert.notEqual(slow.permanent, true)
  mode = 'normal'
})

// ============================ the notifier on top of the relay ===============
const silent = () => { const calls = { log: [], warn: [], error: [] }; return { calls, log: { log: (...a) => calls.log.push(a.join(' ')), warn: (...a) => calls.warn.push(a.join(' ')), error: (...a) => calls.error.push(a.join(' ')) } } }
const complaint = { displayId: 'TVK_AZK_0011', userId: 'u1', category: 'water', title: 'Water problem', description: 'No water', ward: '3rd ward', status: 'accepted', createdAt: new Date('2026-09-16T17:18:17Z'), beforeImageBase64: `data:image/jpeg;base64,${photo.toString('base64')}` }
const args = (email) => ({ complaint, requester: { username: 'Selvi', mobile: '9876543210', email }, stage: 'accepted', previousStatus: 'submitted', changedBy: { username: 'Admin' } })

test('notifier + relay: the office list and the citizen each get their own email, with the photo attached', async () => {
  reset(); const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: createMailer(config()), log, retryDelaysMs: [] })
  assert.equal(await notify(args('Citizen@Example.com')), true)
  assert.deepEqual(script.sent.map((m) => m.to), ['office@example.com, mkumarazk@gmail.com', 'citizen@example.com'])
  for (const mail of script.sent) {
    assert.equal(mail.subject, '[TVK Complaint] TVK_AZK_0011 – Accepted: Water problem')
    assert.equal(mail.attachments.length, 1)
    assert.ok(mail.body.includes('Stage: Submitted → Accepted'))
  }
  assert.equal(buildComplaintEmail(args('x@y.com')).subject, script.sent[0].subject)
})

test('notifier + relay: a wrong secret is reported once with the fix, not retried', async () => {
  reset(); const { calls, log } = silent(); const waits = []
  const mailer = createMailer(config({ relaySecret: 'wrong' }))
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args(null)), false)
  assert.deepEqual(waits, [], 'no retry for a permanent error')
  assert.equal(calls.error.length, 1)
  assert.match(calls.error[0], /MAIL_RELAY_SECRET/)
  assert.equal(calls.error[0].includes('wrong'), false, 'the secret is not logged')
})

test('notifier + relay: a temporary outage is retried and then succeeds', async () => {
  reset(); const { log } = silent(); const waits = []
  const realFetch = globalThis.fetch
  let attempts = 0
  const flaky = (...a) => (++attempts < 3 ? Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })) : realFetch(...a))
  const mailer = createMailer(config(), flaky)
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args(null)), true)
  assert.deepEqual(waits, [2000, 8000])
  assert.equal(script.sent.length, 1)
})

// ============================ configuration & Render advice ==================
test('config: relay is only used when MAIL_TRANSPORT=relay (and needs the URL, the secret AND a MAIL_TO); otherwise Resend', async () => {
  const load = async (vars, tag) => {
    const saved = {}
    for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
    try { return (await import(`../src/config/env.js?${tag}`)).env.mail } finally { for (const k of Object.keys(vars)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]) }
  }
  const def = await load({ RESEND_API_KEY: 're_abc1234567890', MAIL_TO: 'a@x.com' }, 'relay-default')
  assert.equal(def.transport, 'resend'); assert.equal(def.enabled, true)

  const full = await load({ MAIL_TRANSPORT: 'relay', MAIL_RELAY_URL: URL_OK, MAIL_RELAY_SECRET: SECRET, MAIL_TO: 'a@x.com,b@y.com' }, 'relay-full')
  assert.equal(full.transport, 'relay'); assert.equal(full.enabled, true); assert.equal(full.to, 'a@x.com, b@y.com')

  for (const [label, vars] of [
    ['no url', { MAIL_TRANSPORT: 'relay', MAIL_RELAY_SECRET: SECRET, MAIL_TO: 'a@x.com' }],
    ['no secret', { MAIL_TRANSPORT: 'relay', MAIL_RELAY_URL: URL_OK, MAIL_TO: 'a@x.com' }],
    ['no recipients', { MAIL_TRANSPORT: 'relay', MAIL_RELAY_URL: URL_OK, MAIL_RELAY_SECRET: SECRET }],
  ]) assert.equal((await load(vars, `relay-${label.replace(' ', '-')}`)).enabled, false, label)
})

test.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50).unref() })
