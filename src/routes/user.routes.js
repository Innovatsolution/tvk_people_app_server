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
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email address'),
    body('ward').optional().trim().notEmpty().withMessage('Ward cannot be empty'),
  ],
  validate,
  updateMe
)

export default router
