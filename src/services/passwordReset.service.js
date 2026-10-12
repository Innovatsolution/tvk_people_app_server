import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { ApiError } from '../utils/apiError.js'

const OTP_DIGITS = 6
const SALT_ROUNDS = 10

function randomOtp() {
  return String(crypto.randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0')
}

// Constant-time comparison so response timing can't leak how many digits matched.
function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * The forgot-password flow:
 *
 *   requestOtp(mobile)        -> checks the mobile number exists, generates an OTP,
 *                                stores it on that user's document, hands it to
 *                                deliverOtp() (and returns it when configured to).
 *   verifyOtp(mobile, otp)    -> checks the OTP against the one stored on the user
 *                                (expiry + wrong-attempt limit), then issues a
 *                                short-lived resetToken.
 *   resetPassword(token, pwd) -> with a valid resetToken, writes the new password
 *                                hash to that user's document.
 *
 * Fields stored on the user document while an OTP is active:
 *   resetOtp, resetOtpExpiresAt, resetOtpAttempts, resetOtpRequestedAt
 *
 * Everything the service touches is passed in, so it can be unit tested with an
 * in-memory user store (see scripts/test-password-reset.js).
 */
export function createPasswordResetService({
  users, // { findByMobile, findById, update, clearResetOtp }
  config, // { expiryMinutes, maxAttempts, resendSeconds, returnInResponse }
  signResetToken,
  verifyResetToken,
  deliverOtp,
  now = () => Date.now(),
  generateOtp = randomOtp,
  hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS),
}) {
  const expiryMs = config.expiryMinutes * 60 * 1000
  const resendMs = config.resendSeconds * 1000

  async function requestOtp(mobile) {
    const user = await users.findByMobile(mobile)
    if (!user) {
      throw ApiError.coded(404, 'MOBILE_NOT_FOUND', 'No account found for this mobile number')
    }

    const t = now()
    if (user.resetOtpRequestedAt && t - user.resetOtpRequestedAt < resendMs) {
      const retryAfterSeconds = Math.ceil((resendMs - (t - user.resetOtpRequestedAt)) / 1000)
      throw ApiError.coded(
        429,
        'OTP_COOLDOWN',
        `Please wait ${retryAfterSeconds} seconds before requesting another OTP`,
        { retryAfterSeconds }
      )
    }

    const otp = generateOtp()
    await users.update(user.id, {
      resetOtp: otp,
      resetOtpExpiresAt: t + expiryMs,
      resetOtpAttempts: 0,
      resetOtpRequestedAt: t,
    })
    await deliverOtp(user.mobile, otp)

    return {
      expiresInSeconds: config.expiryMinutes * 60,
      resendAfterSeconds: config.resendSeconds,
      ...(config.returnInResponse ? { otp } : {}),
    }
  }

  async function verifyOtp(mobile, otp) {
    const user = await users.findByMobile(mobile)
    if (!user || !user.resetOtp) {
      throw ApiError.coded(400, 'OTP_NOT_REQUESTED', 'Please request an OTP first')
    }

    if (now() > user.resetOtpExpiresAt) {
      await users.clearResetOtp(user.id)
      throw ApiError.coded(400, 'OTP_EXPIRED', 'This OTP has expired. Please request a new one')
    }

    if (!safeEqual(otp, user.resetOtp)) {
      const attempts = (user.resetOtpAttempts || 0) + 1
      if (attempts >= config.maxAttempts) {
        // Invalidate the OTP but KEEP resetOtpRequestedAt, so the resend cooldown
        // still applies - otherwise a locked-out guesser could ask for a fresh OTP
        // straight away and keep guessing.
        await users.update(user.id, { resetOtp: null, resetOtpExpiresAt: null, resetOtpAttempts: 0 })
        throw ApiError.coded(
          429,
          'OTP_TOO_MANY_ATTEMPTS',
          'Too many wrong attempts. Please request a new OTP'
        )
      }
      await users.update(user.id, { resetOtpAttempts: attempts })
      throw ApiError.coded(400, 'OTP_INVALID', 'Incorrect OTP', {
        attemptsLeft: config.maxAttempts - attempts,
      })
    }

    // Correct. The OTP is single-use: remove it now, the reset token is the proof.
    await users.clearResetOtp(user.id)
    return { resetToken: signResetToken(user) }
  }

  async function resetPassword(resetToken, newPassword) {
    const invalid = () =>
      ApiError.coded(401, 'RESET_TOKEN_INVALID', 'Your reset session has expired. Please start again')

    let payload
    try {
      payload = verifyResetToken(resetToken)
    } catch {
      throw invalid()
    }

    const user = await users.findById(payload.sub)
    // The token carries the tail of the old password hash - if the password has
    // already been changed with it, it no longer matches.
    if (!user || !user.passwordHash || user.passwordHash.slice(-16) !== payload.ph) {
      throw invalid()
    }

    const passwordHash = await hashPassword(newPassword)
    await users.update(user.id, { passwordHash })
    await users.clearResetOtp(user.id)
  }

  return { requestOtp, verifyOtp, resetPassword }
}
