import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { listAllComplaints, findComplaintByDisplayId } from '../repositories/complaint.repository.js'
import { findUsersByIds } from '../repositories/user.repository.js'
import { mapComplaint } from '../utils/mapComplaint.js'

function attachRequester(complaint, usersById) {
  const requester = usersById.get(complaint.userId)
  return {
    ...mapComplaint(complaint),
    requester: requester
      ? { id: requester.id, username: requester.username, mobile: requester.mobile }
      : null,
  }
}

// GET /api/admin/complaints?status=&category=&search=
export const listComplaintsForAdmin = asyncHandler(async (req, res) => {
  const { status, category, search } = req.query
  const complaints = await listAllComplaints({ statusFilter: status, category, search })

  const usersById = await findUsersByIds(complaints.map((c) => c.userId))
  const enriched = complaints.map((c) => attachRequester(c, usersById))

  res.json({ complaints: enriched })
})

// GET /api/admin/complaints/:id
export const getComplaintForAdmin = asyncHandler(async (req, res) => {
  const complaint = await findComplaintByDisplayId(req.params.id)
  if (!complaint) throw ApiError.notFound('Complaint not found')

  const usersById = await findUsersByIds([complaint.userId])
  res.json({ complaint: attachRequester(complaint, usersById) })
})
