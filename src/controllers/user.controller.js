import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { findUserById, updateUser, stripSensitive } from '../repositories/user.repository.js'

// GET /api/users/me
export const getMe = asyncHandler(async (req, res) => {
  const user = await findUserById(req.userId)
  if (!user) throw ApiError.notFound('User not found')
  res.json({ user: stripSensitive(user) })
})

// PATCH /api/users/me
// body: any of { username, email, ward }
export const updateMe = asyncHandler(async (req, res) => {
  const allowed = ['username', 'email', 'ward']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }

  const user = await updateUser(req.userId, patch)
  res.json({ user: stripSensitive(user) })
})
