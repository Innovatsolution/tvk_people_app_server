import { buildSteps } from './statusSteps.js'

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
    beforeImageBase64,
    afterImageBase64,
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
    hasBeforeImage: Boolean(beforeImageBase64),
    hasAfterImage: Boolean(afterImageBase64),
    // Already a data: URI (see utils/imageProcessor.js) - usable directly as an <img> src.
    beforeImageUrl: beforeImageBase64 || null,
    afterImageUrl: afterImageBase64 || null,
    rejectReason: rejectReason || null,
    steps: buildSteps(status, statusTimestamps),
  }
}
