import { validationResult } from 'express-validator'
import { ApiError } from '../utils/apiError.js'

export function validate(req, res, next) {
  const result = validationResult(req)
  if (!result.isEmpty()) {
    throw ApiError.badRequest(
      'Validation failed',
      result.array().map((e) => ({ field: e.path, message: e.msg }))
    )
  }
  next()
}
