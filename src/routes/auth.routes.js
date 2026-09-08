import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { signup, login, forgotPassword, me } from '../controllers/auth.controller.js'

const router = Router()

const MOBILE_RE = /^[6-9]\d{9}$/

router.post(
  '/signup',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email address'),
    body('mobile').matches(MOBILE_RE).withMessage('Enter a valid 10-digit mobile number'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match'),
  ],
  validate,
  signup
)

router.post(
  '/login',
  [
    body('mobile').matches(MOBILE_RE).withMessage('Enter a valid 10-digit mobile number'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
)

router.post(
  '/forgot-password',
  [
    body('mobile').matches(MOBILE_RE).withMessage('Enter a valid 10-digit mobile number'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('Passwords do not match'),
  ],
  validate,
  forgotPassword
)

router.get('/me', requireAuth, me)

export default router
