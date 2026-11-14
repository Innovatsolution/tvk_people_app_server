// Run with: npm run mail:check
// Tests the email settings the same way the server uses them: contacts Resend (or the optional Gmail
// relay), and sends a real test email to MAIL_TO. If something is wrong it says what to fix.
// The API key / secret is never printed.
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../src/config/env.js'
import { createMailer, explainMailError } from '../src/services/mailer.js'

const m = env.mail
const ok = (msg) => console.log(`  ✔ ${msg}`)
const bad = (msg) => console.log(`  ✖ ${msg}`)
const note = (msg) => console.log(`    ${msg}`)

console.log('\nTVK email check\n')

// 1. Is there a .env here?
const envFile = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envFile)) ok(`Found .env (${envFile})`)
else {
  note(`No .env file in ${process.cwd()} - fine on a host like Render where settings are typed into its dashboard;`)
  note('on your own computer, run this from the tvk-server folder and make sure the file is named exactly ".env".')
}

if (m.legacySmtpSettings) {
  note('Old SMTP_* settings were found. SMTP is no longer supported, so they are ignored - email goes through Resend now.')
}

let problems = 0
if (m.transport === 'relay') {
  ok('Mode: Gmail relay over HTTPS (MAIL_TRANSPORT=relay)')
  if (!m.relayUrl) { bad('MAIL_RELAY_URL is empty - paste the Web app URL from the Apps Script deployment'); problems += 1 }
  else if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(m.relayUrl)) {
    bad('MAIL_RELAY_URL does not look like https://script.google.com/macros/s/.../exec'); problems += 1
    note('Use the "Web app" URL shown after Deploy (it ends in /exec, not /dev).')
  } else ok('MAIL_RELAY_URL looks right')
  if (!m.relaySecret) { bad('MAIL_RELAY_SECRET is empty - it must be the same text as SECRET inside the Apps Script'); problems += 1 }
  else ok(`MAIL_RELAY_SECRET is set (${m.relaySecret.length} characters)`)
} else {
  ok('Mode: Resend email API (the default)')
  if (!m.resendApiKey) { bad('RESEND_API_KEY is empty - create one at resend.com/api-keys and paste it'); problems += 1 }
  else if (!/^re_[A-Za-z0-9_-]{10,}$/.test(m.resendApiKey)) {
    bad('RESEND_API_KEY does not look like a Resend key (they start with re_) - check for spaces, quotes or a half-copied value'); problems += 1
  } else ok('RESEND_API_KEY looks right')
  ok(`RESEND_FROM = ${m.resendFrom}`)
  if (/@resend\.dev>?$/i.test(m.resendFrom)) {
    note("That is Resend's TEST sender: it can only email the Resend account's own address. To email the office")
    note('addresses and customers, verify your domain in Resend and set RESEND_FROM=TVK Complaints <complaints@yourdomain.com>.')
  }
}
if (!m.to) { bad('MAIL_TO is empty - set it to the inbox(es) that should receive complaint emails'); problems += 1 }
else ok(`MAIL_TO = ${m.to}`)

if (problems) {
  console.log('\nFix the settings above, then run this again.\n')
  process.exit(1)
}
console.log('')

// 2. Connect
const mailer = createMailer(m)
let warning = ''
try {
  const result = await mailer.verify()
  warning = (m.transport !== 'relay' && result?.warning) || ''
  ok(m.transport === 'relay' ? 'The Gmail relay answered and accepted the secret' : 'Resend accepted the API key')
  if (m.transport === 'relay' && result?.remaining !== undefined) note(`Google allows ${result.remaining} more recipients today (limit: 100 a day).`)
  if (m.transport !== 'relay' && result?.summary) note(result.summary)
  if (m.transport !== 'relay' && result?.warning) bad(result.warning)
} catch (err) {
  bad(`Could not connect: ${err.message}`)
  const hint = explainMailError(err, m)
  if (hint) note(hint)
  console.log('\nNo emails can be sent until this is fixed.\n')
  process.exit(1)
}

// 3. Send a real test email
try {
  await mailer.send({
    subject: '[TVK Complaint] Test email - setup is working',
    text:
      'This is a test from the TVK complaint server.\n\n' +
      'If you can read this, the email settings are correct: every complaint stage (new, accepted, ' +
      'rejected, pending, completed) will now be emailed to this address.',
    html:
      '<p>This is a test from the <b>TVK complaint server</b>.</p>' +
      '<p>If you can read this, the email settings are correct: every complaint stage ' +
      '(new, accepted, rejected, pending, completed) will now be emailed to this address.</p>',
  })
  ok(`Test email sent to ${m.to}`)
  note('Open that inbox now. If you do not see it in a minute, look in Spam and in "All Mail".')
  if (warning) {
    console.log('\nThe test email went through, BUT the warning above still applies: until your domain is verified and RESEND_FROM uses it,')
    console.log('Resend will refuse every other address (the office inboxes and citizens). Fix that before relying on complaint emails.\n')
  } else {
    console.log('\nAll good - restart the server and complaint emails will arrive.\n')
  }
} catch (err) {
  bad(`Connected, but sending failed: ${err.message}`)
  const hint = explainMailError(err, m)
  if (hint) note(hint)
  console.log('')
  process.exit(1)
}
