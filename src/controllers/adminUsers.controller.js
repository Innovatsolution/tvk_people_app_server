import bcrypt from 'bcryptjs'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import {
  listAllUsers,
  findUserById,
  findUserByMobile,
  updateUser,
  stripSensitive,
} from '../repositories/user.repository.js'
import { listComplaintsByUser } from '../repositories/complaint.repository.js'
import { mapComplaint } from '../utils/mapComplaint.js'

const SALT_ROUNDS = 10

function formatJoinDate(date) {
  if (!date) return null
  const d = date.toDate ? date.toDate() : new Date(date)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// GET /api/admin/users
// Returns every user with their complaint count, newest signups first.
export const listUsers = asyncHandler(async (req, res) => {
  const users = await listAllUsers()

  const withCounts = await Promise.all(
    users.map(async (user) => {
      const complaints = await listComplaintsByUser(user.id, 'all')
      const safe = stripSensitive(user)
      return { ...safe, joinedOn: formatJoinDate(user.createdAt), complaintCount: complaints.length }
    })
  )

  res.json({ users: withCounts })
})

// GET /api/admin/users/:id
export const getUserDetail = asyncHandler(async (req, res) => {
  const user = await findUserById(req.params.id)
  if (!user) throw ApiError.notFound('User not found')

  const complaints = await listComplaintsByUser(user.id, 'all')

  res.json({
    user: { ...stripSensitive(user), joinedOn: formatJoinDate(user.createdAt) },
    complaints: complaints.map(mapComplaint),
  })
})

// PATCH /api/admin/users/:id
// body: any of { username, email, mobile, ward, role }
export const updateUserByAdmin = asyncHandler(async (req, res) => {
  const target = await findUserById(req.params.id)
  if (!target) throw ApiError.notFound('User not found')

  const allowed = ['username', 'email', 'mobile', 'ward', 'role']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }

  if (patch.role && !['citizen', 'admin'].includes(patch.role)) {
    throw ApiError.badRequest('role must be "citizen" or "admin"')
  }

  if (patch.mobile && patch.mobile !== target.mobile) {
    const existing = await findUserByMobile(patch.mobile)
    if (existing) throw ApiError.conflict('Another account already uses this mobile number')
  }

  const updated = await updateUser(target.id, patch)
  res.json({ user: stripSensitive(updated) })
})

// PATCH /api/admin/users/:id/password
// body: { newPassword }
// Admin sets a user's password directly - no OTP or old-password check,
// since the admin is presumed to have verified the user's identity out of band.
export const setUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body
  const target = await findUserById(req.params.id)
  if (!target) throw ApiError.notFound('User not found')

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await updateUser(target.id, { passwordHash })

  res.json({ message: 'Password updated successfully' })
})
