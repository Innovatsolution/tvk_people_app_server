import { createMailer, explainMailError } from './mailer.js'

// One entry per complaint stage. `short` goes in the subject line.
export const STAGES = {
  submitted: { heading: 'New complaint received', short: 'New', color: '#55606b' },
  accepted: { heading: 'Complaint accepted', short: 'Accepted', color: '#1f6b2d' },
  rejected: { heading: 'Complaint rejected', short: 'Rejected', color: '#a3161a' },
  pending: { heading: 'Work in progress (Pending)', short: 'Pending', color: '#a05c14' },
  completed: { heading: 'Complaint completed', short: 'Completed', color: '#155724' },
}

// The same status names the admin panel shows (used in the "Stage: X → Y" line).
const STATUS_LABELS = { submitted: 'Submitted', accepted: 'Accepted', rejected: 'Rejected', pending: 'Pending', completed: 'Completed' }

const CATEGORY_LABELS = { road: 'Road', light: 'Street light', water: 'Water', waste: 'Waste management', other: 'Other' }

// Complaint text is typed by citizens, so it must never be able to inject HTML into the email.
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

const toMillis = (ts) => (!ts ? 0 : typeof ts.toMillis === 'function' ? ts.toMillis() : new Date(ts).getTime())

const formatIST = (value) => {
  const ms = value instanceof Date ? value.getTime() : toMillis(value)
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// 'data:image/jpeg;base64,....' -> an email attachment (or null if it isn't one)
function photoAttachment(dataUri, filename) {
  const m = /^data:(image\/(?:jpeg|png|gif));base64,(.+)$/i.exec(dataUri || '')
  if (!m) return null
  const ext = m[1].toLowerCase() === 'image/png' ? 'png' : m[1].toLowerCase() === 'image/gif' ? 'gif' : 'jpg'
  return { filename: `${filename}.${ext}`, content: Buffer.from(m[2], 'base64'), contentType: m[1] }
}

/**
 * Builds the email for one stage of one complaint.
 *   complaint      - the complaint document (as stored)
 *   requester      - the citizen's user document (or null)
 *   stage          - 'submitted' | 'accepted' | 'rejected' | 'pending' | 'completed'
 *   previousStatus - the status before this change (omit for a new complaint)
 *   changedBy      - the admin's user document (omit for a new complaint)
 */
export function buildComplaintEmail({ complaint, requester, stage, previousStatus, changedBy, at = new Date() }) {
  const info = STAGES[stage] || { heading: `Status: ${stage}`, short: String(stage), color: '#55606b' }
  const id = complaint.displayId
  const category = CATEGORY_LABELS[complaint.category] || complaint.category || '—'
  const name = requester?.username || '—'
  const mobile = requester?.mobile ? `+91 ${requester.mobile}` : '—'
  const label = (st) => STATUS_LABELS[st] || String(st)
  const stageLine = previousStatus ? `${label(previousStatus)} → ${label(stage)}` : label(stage)
  const actor = stage === 'submitted' ? `Submitted by ${name}` : `Updated by ${changedBy?.username || 'an admin'}`

  const subject = oneLine(`[TVK Complaint] ${id} – ${info.short}: ${complaint.title || ''}`).slice(0, 150)

  const rows = [
    ['Complaint No.', id],
    ['Stage', stageLine],
    ['Name', name],
    ['Mobile', mobile],
    ['Category', category],
    ['Ward / Location', complaint.ward || '—'],
    ['Filed on', formatIST(complaint.createdAt)],
    ['Subject', complaint.title || '—'],
  ]
  if (stage === 'rejected' && complaint.rejectReason) rows.push(['Rejection reason', complaint.rejectReason])

  const description = complaint.description || '—'

  const text = [
    info.heading.toUpperCase(),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Complaint:',
    description,
    '',
    `${actor} · ${formatIST(at)} (IST)`,
  ].join('\n')

  const cell = 'padding:8px 12px;border:1px solid #d9be85;font-size:14px;vertical-align:top;'
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fff8e8;font-family:Segoe UI,Arial,'Nirmala UI',sans-serif;color:#2a1300;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e8;"><tr><td align="center" style="padding:20px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #d9be85;border-radius:10px;overflow:hidden;">
    <tr><td style="background:${info.color};color:#ffffff;padding:16px 20px;">
      <div style="font-size:12px;letter-spacing:1px;opacity:.85;">TVK COMPLAINT MANAGEMENT · ஆழ்வார்குறிச்சி பேரூர்</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${esc(info.heading)}</div>
    </td></tr>
    <tr><td style="padding:18px 20px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${rows.map(([k, v]) => `<tr><td style="${cell}background:#fcedc2;font-weight:600;width:34%;">${esc(k)}</td><td style="${cell}">${esc(v)}</td></tr>`).join('\n        ')}
      </table>
    </td></tr>
    <tr><td style="padding:12px 20px 6px;">
      <div style="font-size:12px;font-weight:700;color:#7a0f0f;margin-bottom:6px;">COMPLAINT</div>
      <div style="border:1px solid #d9be85;padding:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(description)}</div>
    </td></tr>
    <tr><td style="padding:14px 20px 18px;font-size:12px;color:#7c6a4f;">${esc(actor)} · ${esc(formatIST(at))} (IST)<br>Photos, if any, are attached to this email.</td></tr>
  </table>
</td></tr></table></body></html>`

  const attachments = [
    photoAttachment(complaint.beforeImageBase64, `${id}-before`),
    photoAttachment(complaint.afterImageBase64, `${id}-after`),
  ].filter(Boolean)

  return { subject, text, html, attachments }
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/
const splitAddresses = (list) => String(list || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)

// m***@gmail.com - so logs don't spell out a citizen's address
const maskEmail = (addr) => String(addr).replace(/^(.).*(@.*)$/, '$1***$2')

/**
 * Sends the stage email in the background-friendly way: it NEVER throws, so a mail
 * problem can't break (or slow down) the complaint action that triggered it.
 *
 * Who gets it (the same message each time):
 *   1. the office address(es) in MAIL_TO - one email to all of them
 *   2. the citizen who filed the complaint, if their account has an email address - their OWN
 *      separate email, never a CC, so the citizen's address isn't shown to the office and the
 *      office addresses aren't shown to the citizen
 * Each is retried on its own (twice, after 2s then 8s), so one failing never blocks the other.
 *
 * Signup emails are not verified, so a limit stops anyone using the app to flood somebody
 * else's inbox: at most `maxCitizenEmailsPerHour` emails to any one citizen address per hour.
 */
export function createComplaintNotifier({
  mailer,
  log = console,
  retryDelaysMs = [2000, 8000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  maxCitizenEmailsPerHour = 10,
}) {
  let warnedDisabled = false
  const citizenSendLog = new Map() // address -> timestamps (ms) of recent sends

  const citizenAllowed = (address) => {
    const hourAgo = now() - 60 * 60 * 1000
    const recent = (citizenSendLog.get(address) || []).filter((t) => t > hourAgo)
    citizenSendLog.set(address, recent)
    return recent.length < maxCitizenEmailsPerHour
  }

  // One send with the retry rules. Returns true/false, never throws.
  async function sendWithRetry(message, to, label, who) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await mailer.send(to ? { ...message, to } : message)
        log.log(`[mail] ${label} -> sent to ${who}`)
        return true
      } catch (err) {
        // A rejected login (wrong/expired password) or a permanent 5xx refusal won't fix
        // itself in a few seconds, so don't keep retrying those - only network hiccups.
        const permanent = err?.code === 'EAUTH' || (err?.responseCode >= 500 && err?.responseCode < 600)
        if (permanent || attempt >= retryDelaysMs.length) {
          const advice = explainMailError(err, mailer.config)
          const hint = advice ? ` ${advice}` : ''
          log.error(`[mail] ${label} could not be sent to ${who} after ${attempt + 1} attempts: ${err?.message}.${hint}`)
          return false
        }
        await sleep(retryDelaysMs[attempt])
      }
    }
  }

  async function notify(args) {
    try {
      if (!mailer.enabled) {
        if (!warnedDisabled) {
          warnedDisabled = true
          log.warn('[mail] Email notifications are OFF - set SMTP_USER and SMTP_PASS in .env to turn them on.')
        }
        return false
      }

      const message = buildComplaintEmail(args)
      const label = `${args.complaint.displayId} (${args.stage})`

      // 1. the office
      let allSent = await sendWithRetry(message, undefined, label, mailer.to)

      // 2. the citizen, when they gave an email address
      const address = String(args.requester?.email || '').trim().toLowerCase()
      if (mailer.notifyCitizen !== false && !address) {
        log.log(`[mail] ${label}: this citizen has no email address on their account, so only the office was emailed.`)
      }
      if (mailer.notifyCitizen !== false && address) {
        if (!EMAIL_RE.test(address)) {
          log.warn(`[mail] ${label}: the citizen's email address is not valid, so no copy was sent to them.`)
        } else if (splitAddresses(mailer.to).includes(address)) {
          // already in MAIL_TO - they got it above; don't send them a duplicate
        } else if (!citizenAllowed(address)) {
          log.warn(`[mail] ${label}: not sent to ${maskEmail(address)} - that address already received ${maxCitizenEmailsPerHour} emails in the last hour.`)
        } else {
          const sent = await sendWithRetry(message, address, label, `citizen ${maskEmail(address)}`)
          if (sent) citizenSendLog.get(address).push(now())
          allSent = allSent && sent
        }
      }

      return allSent
    } catch (err) {
      log.error('[mail] notification failed:', err?.message)
      return false
    }
  }

  return { notify }
}

export const mailer = createMailer()
export const notifyComplaintStage = createComplaintNotifier({ mailer }).notify
