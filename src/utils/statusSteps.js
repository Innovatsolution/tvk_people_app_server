const REVIEW_COLOR = '#1f8a3b'
const PENDING_COLOR = '#f6b400'
const DONE_COLOR = '#1f8a3b'

function formatDate(date) {
  if (!date) return '—'
  const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date)
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${datePart}\n${timePart}`
}

/**
 * status is one of: 'submitted' | 'accepted' | 'rejected' | 'pending' | 'completed'
 * 'submitted' = filed, awaiting ward officer decision (frontend currently has no
 * dedicated badge for this yet - it renders like an upcoming/awaiting step).
 */
export function buildSteps(status, timestamps = {}) {
  const { reviewedAt, pendingAt, completedAt } = timestamps

  const reviewState = status === 'rejected' ? 'rejected' : ['accepted', 'pending', 'completed'].includes(status) ? 'done' : 'upcoming'
  const pendingState = ['pending', 'completed'].includes(status) ? 'done' : 'upcoming'
  const doneState = status === 'completed' ? 'done' : 'upcoming'

  return [
    {
      key: 'review',
      icon: 'review',
      label: 'ஏற்பு / நிராகரிப்பு',
      state: reviewState,
      color: REVIEW_COLOR,
      date: reviewState === 'upcoming' ? '—' : formatDate(reviewedAt),
    },
    {
      key: 'pending',
      icon: 'progress',
      label: 'நிலுவையில்',
      state: pendingState,
      color: PENDING_COLOR,
      date: pendingState === 'done' ? (status === 'pending' ? 'நடைபெறுகிறது' : formatDate(pendingAt)) : '—',
    },
    {
      key: 'done',
      icon: 'done',
      label: 'முடிந்தது',
      state: doneState,
      color: DONE_COLOR,
      date: doneState === 'done' ? formatDate(completedAt) : '—',
    },
  ]
}
