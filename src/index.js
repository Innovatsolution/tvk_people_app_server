import { app } from './app.js'
import { env } from './config/env.js'
import { mailer } from './services/complaintNotifier.js'
import { explainMailError } from './services/mailer.js'

app.listen(env.port, () => {
  console.log(`TVK complaint API listening on http://localhost:${env.port}`)
  console.log(`CORS allowed origins: ${env.corsOrigins.join(', ')}`)
  console.log(
    env.mail.enabled
      ? `Email notifications ON: every complaint stage is sent to ${env.mail.to} (from ${env.mail.user})`
      : 'Email notifications OFF: set SMTP_USER and SMTP_PASS in .env to turn them on'
  )
  // Try the mail login right now so a wrong password shows up at startup, not silently later.
  if (env.mail.enabled) {
    mailer
      .verify()
      .then(() => console.log('[mail] Email login OK - complaint emails will be delivered.'))
      .catch((err) =>
        console.error(
          `[mail] Email login FAILED: ${err.message}. ${explainMailError(err)} ` +
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
