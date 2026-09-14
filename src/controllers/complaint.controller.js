import { FieldValue } from '../config/firebase.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/apiError.js'
import { generateComplaintId } from '../utils/idGenerator.js'
import { mapComplaint } from '../utils/mapComplaint.js'
import { processImageToBase64 } from '../utils/imageProcessor.js'
import {
  createComplaint,
  findComplaintByDisplayId,
  listComplaintsByUser,
  updateComplaintByDocId,
} from '../repositories/complaint.repository.js'

const VALID_CATEGORIES = ['road', 'light', 'water', 'waste', 'other']
const VALID_STATUSES = ['accepted', 'rejected', 'pending', 'completed']

// GET /api/complaints?status=all|accepted_rejected|pending|completed
export const listComplaints = asyncHandler(async (req, res) => {
  const { status } = req.query
  const complaints = await listComplaintsByUser(req.userId, status)
  res.json({ complaints: complaints.map(mapComplaint) })
})

// GET /api/complaints/:id  (:id is the human-readable TVK_AZK_0001 form)
export const getComplaint = asyncHandler(async (req, res) => {
  const complaint = await findComplaintByDisplayId(req.params.id)
  if (!complaint) throw ApiError.notFound('Complaint not found')
  if (complaint.userId !== req.userId) throw ApiError.forbidden()

  res.json({ complaint: mapComplaint(complaint) })
})

// POST /api/complaints  (multipart/form-data)
// fields: category, title, description, ward
// file:   beforeImage (optional)
export const createComplaintHandler = asyncHandler(async (req, res) => {
  const { category, title, description, ward } = req.body

  if (!VALID_CATEGORIES.includes(category)) {
    throw ApiError.badRequest('Invalid category', [{ field: 'category', message: 'Choose a valid category' }])
  }

  const displayId = await generateComplaintId()
  const beforeImageBase64 = req.file ? await processImageToBase64(req.file.buffer) : null

  const complaint = await createComplaint({
    displayId,
    userId: req.userId,
    category,
    title,
    description,
    ward,
    status: 'submitted', // awaiting ward officer review
    statusTimestamps: {},
    beforeImageBase64,
    afterImageBase64: null,
    rejectReason: null,
  })

  res.status(201).json({ complaint: mapComplaint(complaint) })
})

// PATCH /api/complaints/:id/status  (multipart/form-data)
// fields: status ('accepted' | 'rejected' | 'pending' | 'completed'), rejectReason?
// file:   afterImage (optional, typically attached when status = 'completed')
// Admin-only - see requireAdmin in complaint.routes.js.
export const updateComplaintStatus = asyncHandler(async (req, res) => {
  const { status, rejectReason } = req.body

  if (!VALID_STATUSES.includes(status)) {
    throw ApiError.badRequest('Invalid status', [{ field: 'status', message: 'Choose a valid status' }])
  }
  if (status === 'rejected' && !rejectReason) {
    throw ApiError.badRequest('rejectReason is required when rejecting a complaint')
  }

  const complaint = await findComplaintByDisplayId(req.params.id)
  if (!complaint) throw ApiError.notFound('Complaint not found')

  const patch = { status }

  if (status === 'accepted' || status === 'rejected') {
    patch['statusTimestamps.reviewedAt'] = FieldValue.serverTimestamp()
  }
  if (status === 'pending') {
    patch['statusTimestamps.reviewedAt'] = complaint.statusTimestamps?.reviewedAt || FieldValue.serverTimestamp()
    patch['statusTimestamps.pendingAt'] = FieldValue.serverTimestamp()
  }
  if (status === 'completed') {
    patch['statusTimestamps.completedAt'] = FieldValue.serverTimestamp()
    if (req.file) patch.afterImageBase64 = await processImageToBase64(req.file.buffer)
  }
  if (status === 'rejected') {
    patch.rejectReason = rejectReason
  }

  const updated = await updateComplaintByDocId(complaint.docId, patch)
  res.json({ complaint: mapComplaint(updated) })
})
