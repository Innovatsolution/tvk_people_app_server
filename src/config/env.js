import dotenv from 'dotenv'

dotenv.config()

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill in real values.`
    )
  }
  return value
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Comma-separated list, e.g. "http://localhost:5173,http://localhost:5174"
  // - the citizen app and admin dashboard run on different ports/domains.
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwtSecret: required('JWT_SECRET'),
  // 30 days - the citizen app now keeps the token in localStorage so people
  // stay logged in across app restarts; the token's own lifetime should be
  // long enough to match that expectation rather than forcing a re-login
  // every week.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',

  firebase: {
    projectId: required('FIREBASE_PROJECT_ID'),
    clientEmail: required('FIREBASE_CLIENT_EMAIL'),
    // Downloaded service-account JSON escapes newlines as literal \n; unescape them here.
    privateKey: required('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  },
}
