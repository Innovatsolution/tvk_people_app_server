import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { findUserById, stripSensitive } from '../repositories/user.repository.js'
import { listComplaintsByUser, countComplaintsByUser } from '../repositories/complaint.repository.js'
import { findWardOfficerByWard } from '../repositories/wardOfficer.repository.js'
import { mapComplaint } from '../utils/mapComplaint.js'

// GET /api/dashboard
// Returns everything the Home screen needs in one call: user, total complaint
// count, the most recent complaint (for the tappable status card + mini
// progress dots), and the ward officer's contact details.
export const getDashboard = asyncHandler(async (req, res) => {
  const user = await findUserById(req.userId)
  if (!user) throw ApiError.notFound('User not found')

  const [complaints, totalComplaints, wardOfficer] = await Promise.all([
    listComplaintsByUser(req.userId, 'all'),
    countComplaintsByUser(req.userId),
    findWardOfficerByWard(user.ward),
  ])

  const current = complaints[0] ? mapComplaint(complaints[0]) : null

  res.json({
    user: stripSensitive(user),
    totalComplaints,
    currentComplaint: current,
    wardOfficer,
  })
})
