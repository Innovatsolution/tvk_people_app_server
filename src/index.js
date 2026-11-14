import { app } from './app.js'
import { env } from './config/env.js'
import { mailer } from './services/complaintNotifier.js'
import { explainMailError } from './services/mailer.js'

app.listen(env.port, () => {
  console.log(`TVK complaint API listening on http://localhost:${env.port}`)
  console.log(`CORS allowed origins: ${env.corsOrigins.join(', ')}`)
  console.log(
    env.mail.enabled
      ? `Email notifications ON via ${mailer.via}: every complaint stage is sent to ${env.mail.to}`
      : env.mail.transport === 'relay'
        ? 'Email notifications OFF: with MAIL_TRANSPORT=relay set MAIL_RELAY_URL, MAIL_RELAY_SECRET and MAIL_TO to turn them on'
        : 'Email notifications OFF: set RESEND_API_KEY and MAIL_TO to turn them on (see the README, "Email notifications")'
  )
  if (env.mail.legacySmtpSettings) {
    console.warn(
      '[mail] SMTP_USER / SMTP_PASS / MAIL_TRANSPORT=smtp found - SMTP is no longer supported and those settings are ignored. ' +
        'Email now goes through Resend: set RESEND_API_KEY, RESEND_FROM and MAIL_TO, then delete the old SMTP_* settings.'
    )
  }
  // Try the mail connection right now so a problem shows up at startup, not silently later.
  if (env.mail.enabled) {
    mailer
      .verify()
      .then((result) => {
        if (env.mail.transport === 'relay') {
          console.log(`[mail] Gmail relay OK - complaint emails will be delivered (${result?.remaining ?? '?'} recipients left in today's Google quota).`)
        } else {
          if (result?.summary) console.log(`[mail] Resend OK - ${result.summary}.`)
          if (result?.warning) console.warn(`[mail] WARNING: ${result.warning}`)
        }
      })
      .catch((err) =>
        console.error(
          `[mail] Email check FAILED: ${err.message}. ${explainMailError(err)} ` +
            'Run "npm run mail:check" for a step-by-step check. No emails will be sent until this is fixed.'
        )
      )
  }
  if (env.nodeEnv === 'production' && env.otp.returnInResponse) {
    console.warn(
      'WARNING: OTP_RETURN_IN_RESPONSE=true in production - password-reset OTPs are being ' +
        'returned to the caller, so anyone who knows a registered mobile number can reset its ' +
        'password. Connect an SMS provider in src/services/otpDelivery.js and set it to false.'
    )
  }
})
