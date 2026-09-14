import { Router } from 'express'
import authRoutes from './auth.routes.js'
import userRoutes from './user.routes.js'
import complaintRoutes from './complaint.routes.js'
import wardOfficerRoutes from './wardOfficer.routes.js'
import dashboardRoutes from './dashboard.routes.js'
import adminRoutes from './admin.routes.js'

const router = Router()

router.get('/health', (req, res) => res.json({ status: 'ok' }))

router.use('/auth', authRoutes)
router.use('/users', userRoutes)
router.use('/complaints', complaintRoutes)
router.use('/ward-officer', wardOfficerRoutes)
router.use('/dashboard', dashboardRoutes)
router.use('/admin', adminRoutes)

export default router
