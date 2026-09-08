import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getMyWardOfficer } from '../controllers/wardOfficer.controller.js'

const router = Router()

router.get('/', requireAuth, getMyWardOfficer)

export default router
