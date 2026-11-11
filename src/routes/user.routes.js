import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { getMe, updateMe } from '../controllers/user.controller.js'

const router = Router()

router.use(requireAuth)

router.get('/me', getMe)

router.patch(
  '/me',
  [
    body('username').optional().trim().notEmpty().withMessage('Username cannot be empty'),
    body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Enter a valid email address'),
    // an empty ward is simply ignored (see updateMe) rather than rejected
    body('ward').optional({ checkFalsy: true }).trim(),
  ],
  validate,
  updateMe
)

export default router
