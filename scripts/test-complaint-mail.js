// Run with: npm run test:mail
// Checks the complaint stage emails - content, safety, retry rules - and sends real
// messages through a local SMTP server (no Gmail, no internet needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import os from 'node:os'

// config/env.js reads .env from the current folder. Run from a folder with none, so a developer's
// real .env (with the real mail password) can't change what these tests check.
process.chdir(os.tmpdir())

process.env.JWT_SECRET = 'unit-test'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = 'not-used-by-these-tests'
process.env.SMTP_USER = 'tvkalwarkurichi@gmail.com'
process.env.SMTP_PASS = 'abcd efgh ijkl mnop' // Google shows app passwords with spaces
delete process.env.MAIL_TO
for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'MAIL_FROM']) delete process.env[k]

const { buildComplaintEmail, createComplaintNotifier, STAGES } = await import('../src/services/complaintNotifier.js')
const { createMailer, explainMailError } = await import('../src/services/mailer.js')
const { env } = await import('../src/config/env.js')

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
test('config: sends to tvkalwarkurichi@gmail.com by default, and strips the spaces from a Google app password', () => {
  assert.equal(env.mail.to, 'tvkalwarkurichi@gmail.com')
  assert.equal(env.mail.pass, 'abcdefghijklmnop')
  assert.equal(env.mail.host, 'smtp.gmail.com')
  assert.equal(env.mail.port, 465)
  assert.equal(env.mail.secure, true)
  assert.equal(env.mail.enabled, true)
  assert.equal(env.mail.from, 'TVK Complaints <tvkalwarkurichi@gmail.com>')
})

test('config: stays OFF (and does not crash) when no password is set', async () => {
  const saved = process.env.SMTP_PASS
  delete process.env.SMTP_PASS
  try {
    const fresh = await import('../src/config/env.js?no-password')
    assert.equal(fresh.env.mail.enabled, false)
  } finally { process.env.SMTP_PASS = saved }
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

test('notifier: a rejected Gmail login is NOT retried, and the log says to use an App Password (never the password itself)', async () => {
  let n = 0; const waits = []; const { calls, log } = silent()
  const mailer = { enabled: true, to: 'x@y', send: async () => { n++; throw Object.assign(new Error('Invalid login: 535 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }) } }
  const { notify } = createComplaintNotifier({ mailer, log, sleep: async (ms) => waits.push(ms) })
  assert.equal(await notify(args), false)
  assert.equal(n, 1, 'one attempt only')
  assert.deepEqual(waits, [])
  assert.equal(calls.error.length, 1)
  assert.match(calls.error[0], /App Password/)
  assert.equal(calls.error[0].includes(env.mail.pass), false, 'the password is never logged')
})

test('notifier: even broken input cannot make it throw', async () => {
  const { log } = silent()
  const { notify } = createComplaintNotifier({ mailer: { enabled: true, send: async () => {} }, log, sleep: async () => {} })
  assert.equal(await notify({ complaint: undefined, stage: 'accepted' }), false)
  assert.equal(await notify(undefined), false)
})

// ============================ real SMTP delivery =============================
async function startSmtp({ user, pass }) {
  const received = []
  const server = new SMTPServer({
    authOptional: false,
    allowInsecureAuth: true, // local test server, no TLS
    disabledCommands: ['STARTTLS'],
    onAuth(auth, session, cb) {
      if (auth.username === user && auth.password === pass) return cb(null, { user })
      return cb(Object.assign(new Error('535 5.7.8 Username and Password not accepted'), { responseCode: 535 }))
    },
    onData(stream, session, cb) {
      simpleParser(stream).then((mail) => { received.push({ mail, envelope: session.envelope }); cb() }).catch(cb)
    },
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, received, port: server.server.address().port }
}

test('real SMTP: a stage email is logged in, delivered to tvkalwarkurichi@gmail.com, with its photos attached', async () => {
  const { server, received, port } = await startSmtp({ user: 'tvkalwarkurichi@gmail.com', pass: 'abcdefghijklmnop' })
  try {
    const mailer = createMailer({ ...env.mail, host: '127.0.0.1', port, secure: false })
    const { log } = silent()
    const { notify } = createComplaintNotifier({ mailer, log, retryDelaysMs: [] })

    const done = complaint({ status: 'completed', afterImageBase64: `data:image/jpeg;base64,${AFTER.toString('base64')}`, rejectReason: null })
    assert.equal(await notify({ complaint: done, requester, stage: 'completed', previousStatus: 'pending', changedBy: admin, at }), true)

    assert.equal(received.length, 1)
    const { mail, envelope } = received[0]
    assert.deepEqual(envelope.rcptTo.map((r) => r.address), ['tvkalwarkurichi@gmail.com'])
    assert.equal(mail.from.value[0].address, 'tvkalwarkurichi@gmail.com')
    assert.equal(mail.subject, '[TVK Complaint] TVK_AZK_0011 – Completed: Water problem')
    assert.ok(mail.text.includes('Stage: Pending → Completed'))
    assert.ok(mail.html.includes('ஜோ செல்வர்ஷன்'))
    assert.deepEqual(mail.attachments.map((a) => a.filename).sort(), ['TVK_AZK_0011-after.jpg', 'TVK_AZK_0011-before.jpg'])
    assert.ok(mail.attachments.find((a) => a.filename.endsWith('before.jpg')).content.equals(BEFORE))
    assert.ok(mail.attachments.find((a) => a.filename.endsWith('after.jpg')).content.equals(AFTER))
  } finally { server.close() }
})

test('real SMTP: a wrong password is rejected - reported as a failure, not a crash', async () => {
  const { server, received, port } = await startSmtp({ user: 'tvkalwarkurichi@gmail.com', pass: 'the-real-app-password' })
  try {
    const mailer = createMailer({ ...env.mail, host: '127.0.0.1', port, secure: false, pass: 'wrong-password' })
    const { calls, log } = silent()
    const { notify } = createComplaintNotifier({ mailer, log, retryDelaysMs: [] })
    assert.equal(await notify(args), false)
    assert.equal(received.length, 0)
    assert.equal(calls.error.length, 1)
    assert.match(calls.error[0], /App Password/)
    assert.equal(calls.error[0].includes('wrong-password'), false)
  } finally { server.close() }
})

// ============================ plain-language fixes ===========================
test('explainMailError: the normal-password mistake is explained as "use an App Password"', () => {
  const plain = explainMailError(Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }))
  assert.match(plain, /App Password/)
  assert.match(plain, /not the normal account password/)

  const twoStep = explainMailError(Object.assign(new Error('Invalid login: 534-5.7.9 Application-specific password required'), { code: 'EAUTH', responseCode: 534 }))
  assert.match(twoStep, /App Password is required/)
  assert.match(twoStep, /2-Step Verification/)
})

test('explainMailError: network and setup problems each get their own advice', () => {
  const cfg = { host: 'smtp.gmail.com', port: 465 }
  for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNECTION', 'ESOCKET']) {
    const msg = explainMailError(Object.assign(new Error('x'), { code }), cfg)
    assert.match(msg, /smtp\.gmail\.com:465/, code)
    assert.match(msg, /SMTP_PORT=587/, code)
  }
  assert.match(explainMailError(Object.assign(new Error('error:0A00010B:SSL routines::wrong version number'), { code: 'ESOCKET' }), cfg), /SMTP_SECURE/)
  assert.match(explainMailError(Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gmial.com'), { code: 'ENOTFOUND' }), cfg), /SMTP_HOST/)
  assert.equal(explainMailError(new Error('something unexpected')), '')
})

test('real SMTP: verify() succeeds with the right login and fails (with an explainable error) with a wrong one', async () => {
  const { server, port } = await startSmtp({ user: 'tvkalwarkurichi@gmail.com', pass: 'abcdefghijklmnop' })
  try {
    const good = createMailer({ ...env.mail, host: '127.0.0.1', port, secure: false })
    await good.verify()
    const bad = createMailer({ ...env.mail, host: '127.0.0.1', port, secure: false, pass: 'my-normal-gmail-password' })
    await assert.rejects(bad.verify(), (err) => { assert.match(explainMailError(err), /App Password/); return true })
  } finally { server.close() }
})

// ============================ who receives it ================================
const citizenArgs = (email, over = {}) => ({ ...args, requester: { ...requester, email }, ...over })
const recorder = ({ to = 'office@x.com, mkumarazk@gmail.com', failFor = () => false, notifyCitizen } = {}) => {
  const sent = []
  return { sent, mailer: { enabled: true, to, notifyCitizen, send: async (m) => { if (failFor(m)) throw Object.assign(new Error('refused'), { responseCode: 550 }); sent.push(m) } } }
}

test('config: MAIL_TO can list several addresses (the office + mkumarazk@gmail.com); default is the sending account', async () => {
  process.env.MAIL_TO = 'tvkalwarkurichiperur@gmail.com, mkumarazk@gmail.com ,'
  process.env.NOTIFY_CITIZEN = 'false'
  try {
    const fresh = await import('../src/config/env.js?mail-list')
    assert.equal(fresh.env.mail.to, 'tvkalwarkurichiperur@gmail.com, mkumarazk@gmail.com')
    assert.equal(fresh.env.mail.notifyCitizen, false)
  } finally { delete process.env.MAIL_TO; delete process.env.NOTIFY_CITIZEN }
  const defaults = await import('../src/config/env.js?mail-default')
  assert.equal(defaults.env.mail.to, 'tvkalwarkurichi@gmail.com', 'no MAIL_TO -> the sending account itself')
  assert.equal(defaults.env.mail.notifyCitizen, true, 'citizen copies are on by default')
})

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

test('real SMTP: the office list and the citizen each get exactly one email, and neither sees the other\'s address', async () => {
  const { server, received, port } = await startSmtp({ user: 'tvkalwarkurichi@gmail.com', pass: 'abcdefghijklmnop' })
  try {
    const mailer = createMailer({ ...env.mail, host: '127.0.0.1', port, secure: false, to: 'tvkalwarkurichiperur@gmail.com, mkumarazk@gmail.com' })
    const { log } = silent()
    const { notify } = createComplaintNotifier({ mailer, log, retryDelaysMs: [] })
    assert.equal(await notify(citizenArgs('citizen@example.com', { stage: 'rejected', complaint: complaint({ status: 'rejected', rejectReason: 'Not in our ward' }) })), true)

    assert.equal(received.length, 2)
    const byRcpt = (addr) => received.find((r) => r.envelope.rcptTo.some((x) => x.address === addr))
    const office = byRcpt('tvkalwarkurichiperur@gmail.com')
    const citizen = byRcpt('citizen@example.com')

    assert.deepEqual(office.envelope.rcptTo.map((x) => x.address).sort(), ['mkumarazk@gmail.com', 'tvkalwarkurichiperur@gmail.com'])
    assert.deepEqual(citizen.envelope.rcptTo.map((x) => x.address), ['citizen@example.com'])
    assert.equal(office.mail.to.text.includes('citizen@example.com'), false, "office email doesn't show the citizen's address")
    assert.equal(citizen.mail.to.text.includes('mkumarazk'), false, "citizen email doesn't show the office addresses")
    for (const r of [office, citizen]) {
      assert.equal(r.mail.subject, '[TVK Complaint] TVK_AZK_0011 – Rejected: Water problem')
      assert.ok(r.mail.text.includes('Rejection reason: Not in our ward'))
      assert.equal(r.mail.attachments.length, 1)
    }
  } finally { server.close() }
})

test.after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref())
