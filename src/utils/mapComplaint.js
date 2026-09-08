import { env } from '../config/env.js'
import { buildSteps } from './statusSteps.js'

function toAbsoluteUrl(relativePath) {
  if (!relativePath) return null
  return `${env.publicBaseUrl}${relativePath}`
}

function formatListDate(date) {
  if (!date) return null
  const d = date.toDate ? date.toDate() : new Date(date)
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart} · ${timePart}`
}

export function mapComplaint(complaint) {
  const {
    displayId,
    category,
    title,
    description,
    ward,
    status,
    createdAt,
    statusTimestamps,
    beforeImagePath,
    afterImagePath,
    rejectReason,
  } = complaint

  return {
    id: displayId,
    category,
    title,
    description,
    location: ward,
    date: formatListDate(createdAt),
    status,
    hasBeforeImage: Boolean(beforeImagePath),
    hasAfterImage: Boolean(afterImagePath),
    beforeImageUrl: toAbsoluteUrl(beforeImagePath),
    afterImageUrl: toAbsoluteUrl(afterImagePath),
    rejectReason: rejectReason || null,
    steps: buildSteps(status, statusTimestamps),
  }
}
