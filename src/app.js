import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './config/env.js'
import apiRoutes from './routes/index.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const app = express()

app.use(helmet({ crossOriginResourcePolicy: false })) // allow images to be fetched cross-origin by the app
app.use(cors())
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serves uploaded complaint photos, e.g. GET /uploads/172839_pothole.jpg
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')))

app.use('/api', apiRoutes)

app.use(notFoundHandler)
app.use(errorHandler)
