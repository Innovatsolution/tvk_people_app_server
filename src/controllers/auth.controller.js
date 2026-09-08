import bcrypt from 'bcryptjs'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { signToken } from '../utils/token.js'
import {
  createUser,
  findUserByMobile,
  findUserById,
  updateUser,
  stripSensitive,
} from '../repositories/user.repository.js'

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

// POST /api/auth/forgot-password
// body: { mobile, newPassword, confirmPassword }
//
// NOTE: this resets the password as soon as the mobile number is known, matching
// the current frontend screen. Before going to production, add an OTP-verification
// step (send code -> verify code -> only then allow this call) so anyone who knows
// a mobile number can't reset a stranger's password.
export const forgotPassword = asyncHandler(async (req, res) => {
  const { mobile, newPassword } = req.body

  const user = await findUserByMobile(mobile)
  if (!user) {
    throw ApiError.notFound('No account found for this mobile number')
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await updateUser(user.id, { passwordHash })

  res.json({ message: 'Password updated successfully' })
})

// GET /api/auth/me (sanity-check endpoint for a token)
export const me = asyncHandler(async (req, res) => {
  const user = await findUserById(req.userId)
  if (!user) throw ApiError.notFound('User not found')
  res.json({ user: stripSensitive(user) })
})
