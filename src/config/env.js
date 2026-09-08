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
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  firebase: {
    projectId: required('FIREBASE_PROJECT_ID'),
    clientEmail: required('FIREBASE_CLIENT_EMAIL'),
    // Downloaded service-account JSON escapes newlines as literal \n; unescape them here.
    privateKey: required('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  },
}
