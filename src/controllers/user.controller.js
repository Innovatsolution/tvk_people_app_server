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
    if (req.body[key] === undefined) continue
    // An empty ward means "not filled in" - keep whatever is stored instead of overwriting it.
    if (key === 'ward' && !String(req.body.ward).trim()) continue
    patch[key] = key === 'email' ? String(req.body.email).trim().toLowerCase() : req.body[key]
  }

  const user = await updateUser(req.userId, patch)
  res.json({ user: stripSensitive(user) })
})
