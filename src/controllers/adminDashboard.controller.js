import { asyncHandler } from '../utils/asyncHandler.js'
import { listAllUsers } from '../repositories/user.repository.js'
import { listAllComplaints, countAllComplaintsByStatus } from '../repositories/complaint.repository.js'
import { mapComplaint } from '../utils/mapComplaint.js'

// GET /api/admin/dashboard
export const getAdminDashboard = asyncHandler(async (req, res) => {
  const [users, complaints, countsByStatus] = await Promise.all([
    listAllUsers(),
    listAllComplaints(),
    countAllComplaintsByStatus(),
  ])

  const recentComplaints = complaints.slice(0, 5).map(mapComplaint)

  res.json({
    totalUsers: users.length,
    totalComplaints: complaints.length,
    countsByStatus,
    recentComplaints,
  })
})
