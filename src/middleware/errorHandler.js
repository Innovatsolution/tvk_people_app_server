import { env } from '../config/env.js'

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
}

// Multer's own errors (file too large, unexpected field, etc.) arrive with
// `err.name === 'MulterError'` rather than our own statusCode/ApiError shape -
// translate the common ones to a clear 400 instead of falling through to 500.
function multerMessage(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'That file is too large. Please choose a smaller photo.'
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return 'Unexpected file field.'
  return err.message || 'File upload failed.'
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.name === 'MulterError') {
    return res.status(400).json({ message: multerMessage(err) })
  }

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
