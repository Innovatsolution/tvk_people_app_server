import { env } from '../config/env.js'

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500
  const message = statusCode === 500 && env.nodeEnv === 'production' ? 'Internal server error' : err.message

  if (statusCode === 500) {
    console.error(err)
  }

  res.status(statusCode).json({
    message,
    ...(err.details ? { details: err.details } : {}),
  })
}
