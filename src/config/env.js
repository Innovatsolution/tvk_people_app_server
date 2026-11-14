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

  // Forgot-password OTP settings (see services/passwordReset.service.js)
  otp: {
    expiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 5,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendSeconds: Number(process.env.OTP_RESEND_SECONDS) || 30,
    // true  = the API returns the OTP and the app shows it on screen (no SMS
    //         provider yet). Anyone who knows a registered mobile number can then
    //         read the OTP, so this is NOT safe for production.
    // false = the OTP is only handed to services/otpDelivery.js (wire an SMS
    //         gateway there) and is never sent back to the caller.
    returnInResponse: (process.env.OTP_RETURN_IN_RESPONSE ?? 'true') !== 'false',
  },

  // Admin chatbot (see services/complaintChatbot.service.js + ollama.service.js).
  // The key is optional so the rest of the API still starts without it; the
  // chatbot endpoint just answers 503 until it is set.
  ollama: {
    apiKey: process.env.OLLAMA_API_KEY || '',
    url: process.env.OLLAMA_URL || 'https://ollama.com/api/chat',
    model: process.env.OLLAMA_MODEL || 'gpt-oss:20b',
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 30000,
  },

  // Email notifications: every stage of a complaint (new, accepted, rejected, pending, completed)
  // is emailed through Resend (https://resend.com) - an email API over HTTPS, so it also works on
  // hosts that block normal mail ports (such as Render's free plan). Needs RESEND_API_KEY and
  // MAIL_TO, and a domain you own verified in Resend to email anyone but the Resend account's own
  // address - see the README ("Email notifications"). Until RESEND_API_KEY and MAIL_TO are set the
  // feature is simply off; the rest of the API is unaffected either way.
  mail: (() => {
    const officeRecipients = (process.env.MAIL_TO || '').split(',').map((a) => a.trim()).filter(Boolean)

    // How mail leaves the server:
    //  'resend' (default) - Resend's email API.
    //  'relay'            - optional no-domain fallback: HTTPS through a small Google Apps Script on a
    //                        Gmail account (scripts/gmail-relay.gs). Limited to 100 recipients a day.
    // (SMTP support has been removed.)
    const requested = (process.env.MAIL_TRANSPORT || 'resend').trim().toLowerCase()
    const transport = requested === 'relay' ? 'relay' : 'resend'
    const fromName = process.env.MAIL_FROM_NAME || 'TVK Complaints'
    const resendApiKey = (process.env.RESEND_API_KEY || '').trim()
    const relayUrl = (process.env.MAIL_RELAY_URL || '').trim()
    const relaySecret = (process.env.MAIL_RELAY_SECRET || '').trim()

    return {
      transport,
      fromName,
      // Resend. The default sender is Resend's TEST sender, which only delivers to the Resend
      // account's own address - set RESEND_FROM to an address on your verified domain.
      resendApiKey,
      resendFrom: process.env.RESEND_FROM || process.env.MAIL_FROM || `${fromName} <onboarding@resend.dev>`,
      resendApiUrl: (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, ''),
      resendTimeoutMs: Number(process.env.RESEND_TIMEOUT_MS) || 20000,
      // Optional Gmail relay
      relayUrl,
      relaySecret,
      relayTimeoutMs: Number(process.env.MAIL_RELAY_TIMEOUT_MS) || 30000,
      // Office inbox(es) that get every stage. Comma-separate several addresses.
      to: officeRecipients.join(', '),
      // Also email the citizen who filed the complaint, when their account has an email address.
      notifyCitizen: (process.env.NOTIFY_CITIZEN ?? 'true') !== 'false',
      enabled:
        transport === 'relay'
          ? Boolean(relayUrl && relaySecret && officeRecipients.length)
          : Boolean(resendApiKey && officeRecipients.length),
      // Leftovers from the old SMTP setup - ignored, but the server mentions them at startup.
      legacySmtpSettings: Boolean(process.env.SMTP_USER || process.env.SMTP_PASS || requested === 'smtp'),
    }
  })(),

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
