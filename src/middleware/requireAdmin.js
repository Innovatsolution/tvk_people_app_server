import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { findUserById } from '../repositories/user.repository.js'

// Chains after requireAuth. Looks up the authenticated user's role fresh on
// every request rather than trusting a role embedded in the JWT, so a role
// change (or account disable) takes effect immediately instead of waiting
// for the token to expire.
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const user = await findUserById(req.userId)
  if (!user || user.role !== 'admin') {
    throw ApiError.forbidden('Admin access required')
  }
  req.adminUser = user
  next()
})
