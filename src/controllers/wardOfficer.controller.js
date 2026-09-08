import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { findUserById } from '../repositories/user.repository.js'
import { findWardOfficerByWard } from '../repositories/wardOfficer.repository.js'

// GET /api/ward-officer
// Looks up the officer for the current user's own ward.
export const getMyWardOfficer = asyncHandler(async (req, res) => {
  const user = await findUserById(req.userId)
  if (!user) throw ApiError.notFound('User not found')

  const officer = await findWardOfficerByWard(user.ward)
  if (!officer) throw ApiError.notFound('No ward officer found for your ward')

  res.json({ wardOfficer: officer })
})
