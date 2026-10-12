export class ApiError extends Error {
  constructor(statusCode, message, details, code) {
    super(message)
    this.statusCode = statusCode
    this.details = details
    // Optional machine-readable code (e.g. 'OTP_EXPIRED') so clients can show a
    // translated message instead of parsing the English text.
    this.code = code
  }

  static coded(statusCode, code, message, details) {
    return new ApiError(statusCode, message, details, code)
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details)
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message)
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message)
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message)
  }

  static conflict(message) {
    return new ApiError(409, message)
  }
}
