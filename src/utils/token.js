import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function signToken(userId) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn })
}

// ---- Password-reset token --------------------------------------------------
// Issued only after the OTP has been verified; the only thing it can be used
// for is POST /auth/forgot-password/reset.
//  - It is signed with a DIFFERENT secret than login tokens, so it can never be
//    accepted by requireAuth as a login session.
//  - It embeds the tail of the user's current passwordHash, so once the password
//    has been changed the token stops matching - i.e. it is single-use.
const RESET_SECRET = `${env.jwtSecret}:password-reset`
const RESET_TOKEN_MINUTES = 10

export function signResetToken({ id, passwordHash }) {
  return jwt.sign(
    { sub: id, purpose: 'password-reset', ph: passwordHash.slice(-16) },
    RESET_SECRET,
    { expiresIn: `${RESET_TOKEN_MINUTES}m` }
  )
}

// Throws if the token is invalid, expired, or not a password-reset token.
export function verifyResetToken(token) {
  const payload = jwt.verify(token, RESET_SECRET)
  if (payload.purpose !== 'password-reset') throw new Error('Wrong token purpose')
  return payload
}
