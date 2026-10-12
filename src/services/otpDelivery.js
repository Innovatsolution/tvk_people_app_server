import { env } from '../config/env.js'

// Hands a freshly generated OTP to the user.
//
// There is no SMS provider wired up yet. Until there is, the app relies on
// OTP_RETURN_IN_RESPONSE=true so the API returns the OTP and the app displays it.
//
// To go live: plug your SMS gateway in here (MSG91, Twilio, Fast2SMS, ...) so it
// texts `otp` to `mobile`, then set OTP_RETURN_IN_RESPONSE=false so the OTP is
// never sent back to whoever asked for it.
export async function deliverOtp(mobile, otp) {
  if (env.nodeEnv !== 'production') {
    console.log(`[OTP] ${mobile} -> ${otp}`)
  }
  if (!env.otp.returnInResponse) {
    console.warn(
      `[OTP] An OTP was generated for ${mobile} but no SMS provider is configured in ` +
        'src/services/otpDelivery.js, so it was NOT delivered.'
    )
  }
}
