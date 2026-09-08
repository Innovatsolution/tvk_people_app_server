import { Router } from 'express'
import { body, param, query } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { upload } from '../middleware/upload.js'
import {
  listComplaints,
  getComplaint,
  createComplaintHandler,
  updateComplaintStatus,
} from '../controllers/complaint.controller.js'

const router = Router()

router.use(requireAuth)

router.get(
  '/',
  [query('status').optional().isIn(['all', 'accepted_rejected', 'pending', 'completed'])],
  validate,
  listComplaints
)

router.get('/:id', [param('id').notEmpty()], validate, getComplaint)

router.post(
  '/',
  upload.single('beforeImage'),
  [
    body('category').isIn(['road', 'light', 'water', 'waste', 'other']).withMessage('Choose a valid category'),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('ward').trim().notEmpty().withMessage('Ward / location is required'),
  ],
  validate,
  createComplaintHandler
)

router.patch(
  '/:id/status',
  upload.single('afterImage'),
  [
    param('id').notEmpty(),
    body('status').isIn(['accepted', 'rejected', 'pending', 'completed']).withMessage('Choose a valid status'),
    body('rejectReason').optional().trim(),
  ],
  validate,
  updateComplaintStatus
)

export default router
