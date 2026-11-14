// Run with: npm run test:mail
// Checks the complaint stage emails - content, safety, retry rules - and sends real
// messages through a local SMTP server (no Gmail, no internet needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'

// config/env.js reads .env from the current folder. Run from a folder with none, so a developer's
// real .env (with the real mail password) can't change what these tests check.
process.chdir(os.tmpdir())

process.env.JWT_SECRET = 'unit-test'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = 'not-used-by-these-tests'
for (const k of ['SMTP_USER', 'SMTP_PASS', 'MAIL_TO', 'MAIL_TRANSPORT', 'RESEND_API_KEY', 'RESEND_FROM', 'MAIL_FROM', 'NOTIFY_CITIZEN']) delete process.env[k]

const { buildComplaintEmail, createComplaintNotifier, STAGES } = await import('../src/services/complaintNotifier.js')

const BEFORE = Buffer.from('fake-before-photo-bytes')
const AFTER = Buffer.from('fake-after-photo-bytes')
const complaint = (over = {}) => ({
  docId: 'd1',
  displayId: 'TVK_AZK_0011',
  userId: 'u1',
  category: 'water',
  title: 'Water problem',
  description: 'Water not coming last three days\nPlease check the main valve.',
  ward: '3rd ward , nearby pillayar Kovil Street',
  status: 'submitted',
  createdAt: new Date('2026-09-16T17:18:17Z'), // 16 Sep 10:48 pm IST
  rejectReason: null,
  beforeImageBase64: `data:image/jpeg;base64,${BEFORE.toString('base64')}`,
  afterImageBase64: null,
  ...over,
})
const requester = { username: 'ஜோ செல்வர்ஷன்', mobile: '9876543210' }
const admin = { username: 'Admin' }
const at = new Date('2026-09-17T03:13:00Z') // 17 Sep 8:43 am IST

// ============================ configuration ==================================
test('config: Resend is the default; MAIL_TO lists the office inboxes; the email is OFF until both a key and MAIL_TO are set', async () => {
  const load = async (vars, tag) => {
    const saved = {}
    for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
    try { return (await import(`../src/config/env.js?${tag}`)).env.mail } finally { for (const k of Object.keys(vars)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]) }
  }
  const off = await load({}, 'mail-off')
  assert.equal(off.transport, 'resend'); assert.equal(off.enabled, false); assert.equal(off.to, '')
  assert.equal(off.notifyCitizen, true, 'citizen copies are on by default')

  const on = await load({ RESEND_API_KEY: 're_abc1234567890', MAIL_TO: 'tvkalwarkurichiperur@gmail.com, mkumarazk@gmail.com ,' }, 'mail-on')
  assert.equal(on.enabled, true)
  assert.equal(on.to, 'tvkalwarkurichiperur@gmail.com, mkumarazk@gmail.com')

  assert.equal((await load({ RESEND_API_KEY: 're_abc1234567890' }, 'mail-nomailto')).enabled, false, 'a key but nobody to send to')
  assert.equal((await load({ MAIL_TO: 'a@x.com' }, 'mail-nokey')).enabled, false, 'recipients but no key')
  assert.equal((await load({ NOTIFY_CITIZEN: 'false' }, 'mail-nocitizen')).notifyCitizen, false)
})

test('config: leftover SMTP settings are ignored (and flagged so the server can say so), never used', async () => {
  const saved = { SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS, MAIL_TRANSPORT: process.env.MAIL_TRANSPORT }
  process.env.SMTP_USER = 'old@gmail.com'; process.env.SMTP_PASS = 'abcdefghijklmnop'; process.env.MAIL_TRANSPORT = 'smtp'
  try {
    const m = (await import('../src/config/env.js?legacy-smtp')).env.mail
    assert.equal(m.transport, 'resend', 'MAIL_TRANSPORT=smtp falls back to Resend')
    assert.equal(m.enabled, false, 'an SMTP password does NOT switch email on')
    assert.equal(m.legacySmtpSettings, true)
  } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
})

test('notifier: an error flagged permanent is NOT retried, and the log carries the plain-language fix (never the key)', async () => {
  let n = 0; const waits = []; const { calls, log } = silent()
  const KEY = 're_thisIsTheSecretKey123456'
  const mailer = { enabled: true, to: 'x@y', config: { transport: 'resend' }, send: async () => { n++; throw Object.assign(new Error(`Resend refused: API key is invalid.`), { code: 'ERESEND_AUTH', permanent: true }) } }
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args), false)
  assert.equal(n, 1, 'one attempt only')
  assert.deepEqual(waits, [])
  assert.equal(calls.error.length, 1)
  assert.match(calls.error[0], /resend\.com\/api-keys/)
  assert.equal(calls.error[0].includes(KEY), false)
})

// ============================ email content ==================================
test('every stage gets its own subject, heading and the key details', () => {
  const expected = { submitted: 'New', accepted: 'Accepted', rejected: 'Rejected', pending: 'Pending', completed: 'Completed' }
  for (const [stage, short] of Object.entries(expected)) {
    const m = buildComplaintEmail({ complaint: complaint({ status: stage }), requester, stage, previousStatus: stage === 'submitted' ? undefined : 'submitted', changedBy: admin, at })
    assert.equal(m.subject, `[TVK Complaint] TVK_AZK_0011 – ${short}: Water problem`, stage)
    assert.ok(m.text.includes(STAGES[stage].heading.toUpperCase()), `${stage} heading in text`)
    assert.ok(m.html.includes(STAGES[stage].heading.replace('&', '&amp;')), `${stage} heading in html`)
    for (const needle of ['TVK_AZK_0011', 'ஜோ செல்வர்ஷன்', '+91 9876543210', 'Water', '3rd ward , nearby pillayar Kovil Street', 'Water problem', 'Please check the main valve.']) {
      assert.ok(m.text.includes(needle), `${stage}: text has ${needle}`)
      assert.ok(m.html.includes(needle), `${stage}: html has ${needle}`)
    }
    assert.ok(m.text.includes('16 Sept 2026') || m.text.includes('16 Sep 2026'), 'filed date in IST')
  }
})

test('stage wording: previous -> new status, who did it, and the rejection reason', () => {
  const accepted = buildComplaintEmail({ complaint: complaint(), requester, stage: 'accepted', previousStatus: 'submitted', changedBy: admin, at })
  assert.ok(accepted.text.includes('Stage: Submitted → Accepted'))
  assert.ok(accepted.text.includes('Updated by Admin'))
  assert.ok(accepted.text.includes('17 Sept 2026') || accepted.text.includes('17 Sep 2026'))
  assert.ok(/8:43\s?am/i.test(accepted.text), 'time shown in IST')

  const created = buildComplaintEmail({ complaint: complaint(), requester, stage: 'submitted', at })
  assert.ok(created.text.includes('Stage: Submitted'))
  assert.ok(created.text.includes('Submitted by ஜோ செல்வர்ஷன்'))

  const rejected = buildComplaintEmail({ complaint: complaint({ status: 'rejected', rejectReason: 'Water is coming properly' }), requester, stage: 'rejected', previousStatus: 'submitted', changedBy: admin, at })
  assert.ok(rejected.text.includes('Rejection reason: Water is coming properly'))
  assert.ok(rejected.html.includes('Rejection reason'))
  assert.equal(accepted.text.includes('Rejection reason'), false)
})

test('photos are attached: before photo always, after photo once there is one', () => {
  const one = buildComplaintEmail({ complaint: complaint(), requester, stage: 'accepted', previousStatus: 'submitted', changedBy: admin, at })
  assert.deepEqual(one.attachments.map((a) => a.filename), ['TVK_AZK_0011-before.jpg'])
  assert.ok(one.attachments[0].content.equals(BEFORE))

  const both = buildComplaintEmail({
    complaint: complaint({ status: 'completed', afterImageBase64: `data:image/jpeg;base64,${AFTER.toString('base64')}` }),
    requester, stage: 'completed', previousStatus: 'pending', changedBy: admin, at,
  })
  assert.deepEqual(both.attachments.map((a) => a.filename), ['TVK_AZK_0011-before.jpg', 'TVK_AZK_0011-after.jpg'])

  const none = buildComplaintEmail({ complaint: complaint({ beforeImageBase64: null }), requester, stage: 'accepted', changedBy: admin, at })
  assert.deepEqual(none.attachments, [])
  const junk = buildComplaintEmail({ complaint: complaint({ beforeImageBase64: 'not a data uri' }), requester, stage: 'accepted', changedBy: admin, at })
  assert.deepEqual(junk.attachments, [])
})

test('missing requester / empty fields show a dash instead of crashing', () => {
  const m = buildComplaintEmail({ complaint: complaint({ description: '', ward: '', title: '' }), requester: null, stage: 'accepted', changedBy: null, at })
  assert.ok(m.text.includes('Name: —'))
  assert.ok(m.text.includes('Mobile: —'))
  assert.ok(m.text.includes('Updated by an admin'))
})

test('citizen-typed text cannot inject HTML or extra email headers', () => {
  const evil = complaint({
    title: 'Hi\r\nBcc: attacker@evil.com\r\nSubject: hacked',
    description: '<script>alert(1)</script><img src=x onerror=alert(2)>',
    ward: '"><b>bold</b>',
  })
  const m = buildComplaintEmail({ complaint: evil, requester: { username: '<i>Name</i>', mobile: '9' }, stage: 'accepted', changedBy: admin, at })
  assert.equal(/[\r\n]/.test(m.subject), false, 'subject is a single line')
  assert.equal(m.html.includes('<script>'), false)
  assert.equal(m.html.includes('<img src=x'), false)
  assert.equal(m.html.includes('<b>bold</b>'), false)
  assert.equal(m.html.includes('<i>Name</i>'), false)
  assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
})

// ============================ notifier rules =================================
const silent = () => { const calls = { log: [], warn: [], error: [] }; return { calls, log: { log: (...a) => calls.log.push(a.join(' ')), warn: (...a) => calls.warn.push(a.join(' ')), error: (...a) => calls.error.push(a.join(' ')) } } }
const args = { complaint: complaint(), requester, stage: 'accepted', previousStatus: 'submitted', changedBy: admin, at }

test('notifier: does nothing (and says so once) when email is not configured', async () => {
  const sent = []; const { calls, log } = silent()
  const { notify } = createComplaintNotifier({ mailer: { enabled: false, send: async (m) => sent.push(m) }, log })
  assert.equal(await notify(args), false)
  assert.equal(await notify(args), false)
  assert.equal(sent.length, 0)
  assert.equal(calls.warn.length, 1, 'only one warning, not one per complaint')
})

test('notifier: a send that works first time is not retried', async () => {
  const sent = []; const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: { enabled: true, to: 'x@y', send: async (m) => sent.push(m) }, log, sleep: async () => {} })
  assert.equal(await notify(args), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].subject, '[TVK Complaint] TVK_AZK_0011 – Accepted: Water problem')
})

test('notifier: retries after 2s then 8s, and succeeds on the third try', async () => {
  let n = 0; const waits = []; const { log } = silent()
  const mailer = { enabled: true, to: 'x@y', send: async () => { if (++n < 3) throw new Error('temporary failure') } }
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args), true)
  assert.equal(n, 3)
  assert.deepEqual(waits, [2000, 8000])
})

test('notifier: a temporary failure is retried 3 times in total, then given up on - without throwing', async () => {
  let n = 0; const { calls, log } = silent()
  const mailer = { enabled: true, to: 'x@y', send: async () => { n++; throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }) } }
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async () => {} })
  assert.equal(await notify(args), false)
  assert.equal(n, 3)
  assert.equal(calls.error.length, 1)
})

test('notifier: even broken input cannot make it throw', async () => {
  const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: { enabled: true, send: async () => {} }, log, sleep: async () => {} })
  assert.equal(await notify({ complaint: undefined, stage: 'accepted' }), false)
  assert.equal(await notify(undefined), false)
})

// ============================ real SMTP delivery =============================
// ============================ plain-language fixes ===========================
// ============================ who receives it ================================
const citizenArgs = (email, over = {}) => ({ ...args, requester: { ...requester, email }, ...over })
const recorder = ({ to = 'office@x.com, mkumarazk@gmail.com', failFor = () => false, notifyCitizen } = {}) => {
  const sent = []
  return { sent, mailer: { enabled: true, to, notifyCitizen, send: async (m) => { if (failFor(m)) throw Object.assign(new Error('refused'), { responseCode: 550 }); sent.push(m) } } }
}

test('a citizen with an email gets their OWN copy of the same message; the office gets one email for all its addresses', async () => {
  const { sent, mailer } = recorder(); const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async () => {} })
  assert.equal(await notify(citizenArgs('Citizen@Example.com')), true)

  assert.equal(sent.length, 2)
  const [office, citizen] = sent
  assert.equal(office.to, undefined, 'office email uses the MAIL_TO list (office + mkumarazk)')
  assert.equal(citizen.to, 'citizen@example.com', 'citizen email goes ONLY to the citizen')
  for (const k of ['subject', 'text', 'html']) assert.equal(citizen[k], office[k], `same ${k}`)
  assert.deepEqual(citizen.attachments.map((a) => a.filename), office.attachments.map((a) => a.filename), 'same photos')
})

test('no email on the account -> only the office is emailed', async () => {
  for (const email of [undefined, null, '', '   ']) {
    const { sent, mailer } = recorder(); const { log } = silent()
    await createComplaintNotifier({ mailer, log, sleep: async () => {} }).notify(citizenArgs(email))
    assert.equal(sent.length, 1, `email=${JSON.stringify(email)}`)
  }
})

test('when a citizen has no email the log says so (so "why no copy?" is answered in the server log)', async () => {
  const { sent, mailer } = recorder(); const { calls, log } = silent()
  await createComplaintNotifier({ mailer, log, sleep: async () => {} }).notify(citizenArgs(null))
  assert.equal(sent.length, 1)
  assert.ok(calls.log.some((l) => l.includes('no email address on their account')), calls.log.join(' | '))
})

test('an invalid address is skipped with a warning, not sent', async () => {
  const { sent, mailer } = recorder(); const { calls, log } = silent()
  await createComplaintNotifier({ mailer, log, sleep: async () => {} }).notify(citizenArgs('not-an-email'))
  assert.equal(sent.length, 1)
  assert.equal(calls.warn.length, 1)
})

test('a citizen whose address is already in MAIL_TO is not emailed twice', async () => {
  const { sent, mailer } = recorder({ to: 'office@x.com, MKumarAZK@gmail.com' }); const { log } = silent()
  await createComplaintNotifier({ mailer, log, sleep: async () => {} }).notify(citizenArgs('mkumarazk@gmail.com'))
  assert.equal(sent.length, 1)
})

test('NOTIFY_CITIZEN=false turns the citizen copy off', async () => {
  const { sent, mailer } = recorder({ notifyCitizen: false }); const { log } = silent()
  await createComplaintNotifier({ mailer, log, sleep: async () => {} }).notify(citizenArgs('citizen@example.com'))
  assert.equal(sent.length, 1)
})

test('abuse limit: at most 10 emails an hour to one citizen address, then it recovers', async () => {
  const { sent, mailer } = recorder(); const { calls, log } = silent()
  const clock = { t: Date.parse('2026-09-17T06:00:00Z') }
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async () => {}, now: () => clock.t })
  const toCitizen = () => sent.filter((m) => m.to === 'victim@example.com').length

  for (let i = 0; i < 12; i += 1) { clock.t += 60_000; await notify(citizenArgs('victim@example.com')) }
  assert.equal(toCitizen(), 10, 'capped at 10 in the hour')
  assert.equal(sent.filter((m) => !m.to).length, 12, 'the office still gets every one')
  assert.equal(calls.warn.length, 2)
  assert.equal(calls.warn.join('').includes('victim@example.com'), false, 'the address is masked in the log')

  await notify(citizenArgs('someone-else@example.com'))
  assert.equal(sent.filter((m) => m.to === 'someone-else@example.com').length, 1, 'other addresses are unaffected')

  clock.t += 61 * 60_000
  await notify(citizenArgs('victim@example.com'))
  assert.equal(toCitizen(), 11, 'allowed again after the hour')
})

test('the office and the citizen are independent: one failing never blocks the other', async () => {
  // office refused, citizen fine
  let r = recorder({ failFor: (m) => !m.to }); let { log } = silent()
  assert.equal(await createComplaintNotifier({ mailer: r.mailer, log, sleep: async () => {} }).notify(citizenArgs('citizen@example.com')), false)
  assert.deepEqual(r.sent.map((m) => m.to), ['citizen@example.com'])
  // citizen refused, office fine
  r = recorder({ failFor: (m) => Boolean(m.to) }); ({ log } = silent())
  assert.equal(await createComplaintNotifier({ mailer: r.mailer, log, sleep: async () => {} }).notify(citizenArgs('citizen@example.com')), false)
  assert.deepEqual(r.sent.map((m) => m.to), [undefined])
})

test('a failed citizen send does not count against their hourly limit', async () => {
  const r = recorder({ failFor: (m) => Boolean(m.to) }); const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: r.mailer, log, sleep: async () => {}, maxCitizenEmailsPerHour: 1 })
  await notify(citizenArgs('citizen@example.com'))
  r.mailer.send = async (m) => { r.sent.push(m) } // mail server recovers
  await notify(citizenArgs('citizen@example.com'))
  assert.equal(r.sent.filter((m) => m.to === 'citizen@example.com').length, 1)
})

test.after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref())
