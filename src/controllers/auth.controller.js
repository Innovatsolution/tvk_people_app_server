import bcrypt from 'bcryptjs'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { signToken, signResetToken, verifyResetToken } from '../utils/token.js'
import { env } from '../config/env.js'
import {
  createUser,
  findUserByMobile,
  findUserById,
  updateUser,
  clearResetOtp,
  stripSensitive,
} from '../repositories/user.repository.js'
import { createPasswordResetService } from '../services/passwordReset.service.js'
import { deliverOtp } from '../services/otpDelivery.js'

const SALT_ROUNDS = 10

// POST /api/auth/signup
// body: { username, email?, mobile, password, confirmPassword, ward? }
export const signup = asyncHandler(async (req, res) => {
  const { username, email, mobile, password, ward } = req.body

  const existing = await findUserByMobile(mobile)
  if (existing) {
    throw ApiError.conflict('An account with this mobile number already exists')
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
  const user = await createUser({ username, email, mobile, passwordHash, ward })
  const token = signToken(user.id)

  res.status(201).json({ token, user: stripSensitive(user) })
})

// POST /api/auth/login
// body: { mobile, password }
export const login = asyncHandler(async (req, res) => {
  const { mobile, password } = req.body

  const user = await findUserByMobile(mobile)
  if (!user) {
    throw ApiError.unauthorized('Invalid mobile number or password')
  }

  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) {
    throw ApiError.unauthorized('Invalid mobile number or password')
  }

  const token = signToken(user.id)
  res.json({ token, user: stripSensitive(user) })
})

// ---- Forgot password (OTP flow) ------------------------------------------
// 1. POST /auth/forgot-password/request-otp  { mobile }
// 2. POST /auth/forgot-password/verify-otp   { mobile, otp }       -> { resetToken }
// 3. POST /auth/forgot-password/reset        { resetToken, newPassword, confirmPassword }
// The rules (expiry, attempt limit, cooldown) live in services/passwordReset.service.js.
const passwordReset = createPasswordResetService({
  users: {
    findByMobile: findUserByMobile,
    findById: findUserById,
    update: updateUser,
    clearResetOtp,
  },
  config: env.otp,
  signResetToken,
  verifyResetToken,
  deliverOtp,
})

// Checks the mobile number is registered, generates an OTP and stores it on that
// user's document. The OTP is included in the response only when
// OTP_RETURN_IN_RESPONSE=true (see config/env.js).
export const requestPasswordResetOtp = asyncHandler(async (req, res) => {
  const result = await passwordReset.requestOtp(req.body.mobile)
  res.json({ message: 'OTP generated', ...result })
})

export const verifyPasswordResetOtp = asyncHandler(async (req, res) => {
  const { resetToken } = await passwordReset.verifyOtp(req.body.mobile, req.body.otp)
  res.json({ message: 'OTP verified', resetToken })
})

export const resetPassword = asyncHandler(async (req, res) => {
  await passwordReset.resetPassword(req.body.resetToken, req.body.newPassword)
  res.json({ message: 'Password updated successfully' })
})

// GET /api/auth/me (sanity-check endpoint for a token)
export const me = asyncHandler(async (req, res) => {
  const user = await findUserById(req.userId)
  if (!user) throw ApiError.notFound('User not found')
  res.json({ user: stripSensitive(user) })
})
