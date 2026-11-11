import nodemailer from 'nodemailer'
import { env } from '../config/env.js'

// Thin wrapper around an SMTP connection. Settings come from .env (see config/env.js).
// `config` / `createTransport` can be replaced in tests.
export function createMailer(config = env.mail, createTransport = nodemailer.createTransport) {
  let transport

  const getTransport = () => {
    if (!transport) {
      transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure, // true = TLS from the start (port 465, what Gmail uses)
        auth: { user: config.user, pass: config.pass },
        // never let a slow mail server hang a request or pile up open sockets
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      })
    }
    return transport
  }

  return {
    enabled: config.enabled,
    to: config.to,
    notifyCitizen: config.notifyCitizen,
    config,
    // Logs in to the mail server without sending anything - used at startup and by `npm run mail:check`.
    verify: () => getTransport().verify(),
    // `to` defaults to the office address(es); pass one to send somewhere else (e.g. the citizen).
    async send({ subject, text, html, attachments, to }) {
      const info = await getTransport().sendMail({ from: config.from, to: to || config.to, subject, text, html, attachments })
      return { messageId: info.messageId }
    },
  }
}

// Turns a mail error into "what to do about it", in plain words (empty string if unknown).
export function explainMailError(err, config = env.mail) {
  const text = `${err?.response || ''} ${err?.message || ''}`
  const code = err?.code

  if (code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 534) {
    if (err?.responseCode === 534 || /application-specific|app password/i.test(text)) {
      return (
        'Gmail says an App Password is required: turn on 2-Step Verification for the account, create an App Password ' +
        '(Google Account > Security > App passwords) and use that as SMTP_PASS - not the normal account password.'
      )
    }
    return (
      'Gmail rejected the login. SMTP_PASS must be a Google App Password (Google Account > Security > 2-Step ' +
      'Verification > App passwords), not the normal account password - and SMTP_USER must be the Gmail address it was created for.'
    )
  }
  if (/wrong version number|ssl routines|tls/i.test(text)) {
    return "SMTP_PORT and SMTP_SECURE don't match: port 465 needs SMTP_SECURE=true, port 587 needs SMTP_SECURE=false."
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ESOCKET', 'ECONNRESET'].includes(code)) {
    return (
      `Could not connect to ${config.host}:${config.port}. A firewall, your hosting provider or your network may be ` +
      'blocking this port - try SMTP_PORT=587 with SMTP_SECURE=false.'
    )
  }
  if (code === 'ENOTFOUND' || code === 'EDNS') {
    return 'The mail server name could not be found - check the internet connection and SMTP_HOST.'
  }
  return ''
}
