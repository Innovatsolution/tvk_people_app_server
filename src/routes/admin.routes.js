import { Router } from 'express'
import { body, param, query } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { getAdminDashboard } from '../controllers/adminDashboard.controller.js'
import {
  listUsers,
  getUserDetail,
  updateUserByAdmin,
  setUserPassword,
} from '../controllers/adminUsers.controller.js'
import { listComplaintsForAdmin, getComplaintForAdmin } from '../controllers/adminComplaints.controller.js'

const router = Router()

// Every admin route requires a valid session AND the admin role.
router.use(requireAuth, requireAdmin)

router.get('/dashboard', getAdminDashboard)

router.get('/users', listUsers)
router.get('/users/:id', [param('id').notEmpty()], validate, getUserDetail)
router.patch(
  '/users/:id',
  [
    param('id').notEmpty(),
    body('username').optional().trim().notEmpty(),
    body('email').optional({ checkFalsy: true }).isEmail(),
    body('mobile').optional().matches(/^[6-9]\d{9}$/),
    body('ward').optional().trim(),
    body('role').optional().isIn(['citizen', 'admin']),
  ],
  validate,
  updateUserByAdmin
)
router.patch(
  '/users/:id/password',
  [param('id').notEmpty(), body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
  validate,
  setUserPassword
)

router.get(
  '/complaints',
  [query('status').optional().isIn(['all', 'accepted_rejected', 'pending', 'completed'])],
  validate,
  listComplaintsForAdmin
)
router.get('/complaints/:id', [param('id').notEmpty()], validate, getComplaintForAdmin)

export default router
