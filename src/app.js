import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import apiRoutes from './routes/index.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

export const app = express()

app.use(helmet())
app.use(cors())
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Note: complaint photos are stored as base64 data URIs directly on the
// Firestore document (see utils/imageProcessor.js) - there's no /uploads
// static file serving because nothing is ever written to disk.

app.use('/api', apiRoutes)

app.use(notFoundHandler)
app.use(errorHandler)
