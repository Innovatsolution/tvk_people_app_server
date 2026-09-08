import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../utils/apiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header')
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.userId = payload.sub
    next()
  } catch {
    throw ApiError.unauthorized('Invalid or expired token')
  }
})
