// Run with: npm run mail:check
// Tests the email settings in .env the same way the server uses them: logs in to the mail
// server and sends a real test email to MAIL_TO. If something is wrong it says what to fix.
// The password itself is never printed.
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../src/config/env.js'
import { createMailer, explainMailError } from '../src/services/mailer.js'

const { user, pass, host, port, secure, to } = env.mail
const ok = (m) => console.log(`  ✔ ${m}`)
const bad = (m) => console.log(`  ✖ ${m}`)
const note = (m) => console.log(`    ${m}`)

console.log('\nTVK email check\n')

// 1. Is there a .env here, and does it have the settings?
const envFile = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envFile)) ok(`Found .env (${envFile})`)
else {
  bad(`No .env file in ${process.cwd()}`)
  note('Run this command from the tvk-server folder, and make sure the file is named exactly ".env".')
}

if (!user) bad('SMTP_USER is empty - set it to the Gmail address, e.g. SMTP_USER=tvkalwarkurichi@gmail.com')
else ok(`SMTP_USER = ${user}`)

if (!pass) bad('SMTP_PASS is empty - paste the Google App Password after SMTP_PASS=')
else {
  const looksRight = pass.length === 16 && /^[a-z]+$/i.test(pass)
  if (looksRight) ok('SMTP_PASS is 16 letters - the right shape for a Google App Password')
  else {
    bad(`SMTP_PASS is ${pass.length} characters. A Google App Password is exactly 16 letters (no digits or symbols).`)
    note('If this is your normal Gmail password, Google will refuse it - create an App Password instead.')
    note('(If your value contains a # sign, put the whole value in quotes: SMTP_PASS="...", otherwise everything after # is dropped.)')
  }
}

if (!user || !pass) {
  console.log('\nFix the settings above, then run this again.\n')
  process.exit(1)
}

console.log(`\n  Server: ${host}:${port} (${secure ? 'secure from the start' : 'STARTTLS'})   Sending to: ${to}\n`)

// 2. Log in
const mailer = createMailer(env.mail)
try {
  await mailer.verify()
  ok('Logged in to the mail server')
} catch (err) {
  bad(`Could not log in: ${err.message}`)
  const hint = explainMailError(err, env.mail)
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
  ok(`Test email sent to ${to}`)
  note('Open that inbox now. If you do not see it in a minute, look in Spam and in "All Mail".')
  console.log('\nAll good - restart the server and complaint emails will arrive.\n')
} catch (err) {
  bad(`Logged in, but sending failed: ${err.message}`)
  const hint = explainMailError(err, env.mail)
  if (hint) note(hint)
  console.log('')
  process.exit(1)
}
