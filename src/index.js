import { app } from './app.js'
import { env } from './config/env.js'

app.listen(env.port, () => {
  console.log(`TVK complaint API listening on http://localhost:${env.port}`)
  console.log(`CORS allowed origins: ${env.corsOrigins.join(', ')}`)
  if (env.nodeEnv === 'production' && env.otp.returnInResponse) {
    console.warn(
      'WARNING: OTP_RETURN_IN_RESPONSE=true in production - password-reset OTPs are being ' +
        'returned to the caller, so anyone who knows a registered mobile number can reset its ' +
        'password. Connect an SMS provider in src/services/otpDelivery.js and set it to false.'
    )
  }
})
