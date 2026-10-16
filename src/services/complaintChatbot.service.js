// Turns an admin's plain-language question into a complaint search and a readable answer.
//
//   question --(AI)--> rough JSON filter --normalizeFilter--> trusted filter
//            --> Firestore equality query + matchesFilter (dates / text) --> reply
//
// The AI only ever sees the question, never complaint data. Whatever it returns
// is treated as untrusted: normalizeFilter() keeps only known keys, maps wording
// onto the values this app really stores, and drops anything it can't validate -
// so the AI can narrow a search but can't make the server run anything else.

export const MAX_RESULTS = 20

// The only values stored in the database.
export const CATEGORIES = ['road', 'light', 'water', 'waste', 'other']
export const STATUSES = ['submitted', 'accepted', 'rejected', 'pending', 'completed']

const CATEGORY_LABELS = {
  road: 'Road',
  light: 'Street light',
  water: 'Water',
  waste: 'Waste management',
  other: 'Other',
}
const STATUS_LABELS = {
  submitted: 'Submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  pending: 'Pending',
  completed: 'Completed',
}

// Wording the AI (or the admin) might use -> the stored value.
const CATEGORY_ALIASES = {
  road: 'road', roads: 'road',
  light: 'light', lights: 'light', streetlight: 'light', streetlights: 'light',
  'street light': 'light', 'street lights': 'light', lamp: 'light', lamps: 'light',
  electricity: 'light', electric: 'light',
  water: 'water', 'drinking water': 'water',
  waste: 'waste', garbage: 'waste', trash: 'waste', sanitation: 'waste', 'waste management': 'waste',
  other: 'other', others: 'other',
}
const STATUS_ALIASES = {
  submitted: 'submitted', new: 'submitted', open: 'submitted', filed: 'submitted',
  awaiting: 'submitted', 'awaiting review': 'submitted', unreviewed: 'submitted',
  accepted: 'accepted', approved: 'accepted',
  rejected: 'rejected', declined: 'rejected', denied: 'rejected',
  pending: 'pending', 'in progress': 'pending', ongoing: 'pending', processing: 'pending',
  'under process': 'pending', 'work in progress': 'pending',
  completed: 'completed', complete: 'completed', resolved: 'completed', done: 'completed',
  closed: 'completed', finished: 'completed', fixed: 'completed',
}

const IST_OFFSET = '+05:30'
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const aliasKey = (v) => String(v).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
const cleanText = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '')

// "Today" in India (the app's users and admins), as YYYY-MM-DD.
export function todayIST(nowMs = Date.now()) {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10)
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null
  const s = v.trim()
  const d = new Date(`${s}T00:00:00Z`)
  // reject things like 2026-02-31 that JS would silently roll over
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

/**
 * raw: whatever JSON the AI produced. Returns a filter containing only
 * validated values: { intent, category?, status?, displayId?, userId?,
 * wardContains?, textContains?, fromDate?, toDate? }
 */
export function normalizeFilter(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const filter = { intent: src.intent === 'count' ? 'count' : 'list' }

  let textContains = cleanText(src.textContains)

  if (typeof src.category === 'string' && src.category.trim()) {
    const known = CATEGORY_ALIASES[aliasKey(src.category)] || CATEGORY_ALIASES[aliasKey(src.category).replace(/ /g, '')]
    if (known) filter.category = known
    // A topic that isn't one of our categories (e.g. "drainage") is still worth
    // searching for - look for the word in the complaint text instead.
    else if (!textContains) textContains = cleanText(src.category)
  }

  if (typeof src.status === 'string' && src.status.trim()) {
    const known = STATUS_ALIASES[aliasKey(src.status)]
    if (known) filter.status = known
  }

  // Every complaint ID is TVK_AZK_<4 digits>, so "azk0011", "TVK_AZK_11" or just
  // "0011" all mean the same complaint - rebuild the canonical ID from the number.
  if (typeof src.displayId === 'string' || typeof src.displayId === 'number') {
    const m = String(src.displayId).match(/(\d{1,6})\s*$/)
    if (m) filter.displayId = `TVK_AZK_${m[1].replace(/^0+(?=\d)/, '').padStart(4, '0')}`
  }

  if (typeof src.userId === 'string' && src.userId.trim()) filter.userId = src.userId.trim().slice(0, 100)

  const ward = cleanText(src.wardContains)
  if (ward) filter.wardContains = ward
  if (textContains) filter.textContains = textContains

  let from = validDate(src.fromDate)
  let to = validDate(src.toDate)
  if (from && to && from > to) [from, to] = [to, from]
  if (from) filter.fromDate = from
  if (to) filter.toDate = to

  return filter
}

const toMillis = (ts) => (!ts ? 0 : typeof ts.toMillis === 'function' ? ts.toMillis() : new Date(ts).getTime())
const includesText = (value, needle) => String(value || '').toLowerCase().includes(needle.toLowerCase())

// The filters Firestore can't do (or that we do here to avoid composite indexes).
export function matchesFilter(row, filter) {
  if (filter.fromDate || filter.toDate) {
    const t = toMillis(row.createdAt)
    if (!t) return false
    if (filter.fromDate && t < Date.parse(`${filter.fromDate}T00:00:00.000${IST_OFFSET}`)) return false
    if (filter.toDate && t > Date.parse(`${filter.toDate}T23:59:59.999${IST_OFFSET}`)) return false
  }
  if (filter.wardContains && !includesText(row.ward, filter.wardContains)) return false
  if (filter.textContains && !(includesText(row.title, filter.textContains) || includesText(row.description, filter.textContains))) {
    return false
  }
  return true
}

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// Human-readable pieces of the filter, e.g. ["category: Water", "created on 17 Sep 2026"]
export function describeFilter(filter) {
  const parts = []
  if (filter.displayId) parts.push(`ID ${filter.displayId}`)
  if (filter.status) parts.push(`status: ${STATUS_LABELS[filter.status]}`)
  if (filter.category) parts.push(`category: ${CATEGORY_LABELS[filter.category]}`)
  if (filter.wardContains) parts.push(`ward: “${filter.wardContains}”`)
  if (filter.textContains) parts.push(`text: “${filter.textContains}”`)
  if (filter.userId) parts.push('from that user')
  if (filter.fromDate && filter.toDate) {
    parts.push(filter.fromDate === filter.toDate
      ? `created on ${fmtDay(filter.fromDate)}`
      : `created ${fmtDay(filter.fromDate)} to ${fmtDay(filter.toDate)}`)
  } else if (filter.fromDate) parts.push(`created from ${fmtDay(filter.fromDate)}`)
  else if (filter.toDate) parts.push(`created up to ${fmtDay(filter.toDate)}`)
  return parts
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function composeReply({ intent, total, shown, filter }) {
  const parts = describeFilter(filter)
  const scope = parts.length ? ` (${parts.join('; ')})` : ''
  if (total === 0) return `No complaints found${parts.length ? ` for ${parts.join('; ')}` : ''}.`
  if (intent === 'count') {
    return `There ${total === 1 ? 'is' : 'are'} ${plural(total, 'complaint')}${parts.length ? scope : ' in total'}.`
  }
  const more = total > shown ? ` Showing the latest ${shown}.` : ''
  return `Found ${plural(total, 'complaint')}${scope}.${more}`
}

const tally = (rows, field) => rows.reduce((acc, r) => ((acc[r[field] || 'unknown'] = (acc[r[field] || 'unknown'] || 0) + 1), acc), {})

const fmtDateTime = (ts) => {
  const t = toMillis(ts)
  if (!t) return null
  return new Date(t).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function toChatComplaint(row, requester) {
  const description = String(row.description || '')
  return {
    id: row.displayId,
    title: row.title || '',
    description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    status: row.status,
    ward: row.ward || '',
    rejectReason: row.rejectReason || null,
    createdAt: fmtDateTime(row.createdAt),
    requester: requester ? { username: requester.username, mobile: requester.mobile } : null,
  }
}

/**
 * askLlmForFilter(question, { today }) -> raw filter object (may throw ApiError)
 * searchComplaints(filter)             -> rows (equality filters applied)
 * findUsersByIds(ids)                  -> Map(userId -> user)
 */
export function createComplaintChatbot({ askLlmForFilter, searchComplaints, findUsersByIds, now = () => Date.now() }) {
  async function answer(message) {
    const raw = await askLlmForFilter(message, { today: todayIST(now()) })
    const filter = normalizeFilter(raw)

    const rows = await searchComplaints(filter)
    const matched = rows
      .filter((r) => matchesFilter(r, filter))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))

    const total = matched.length
    const summary = { total, byStatus: tally(matched, 'status'), byCategory: tally(matched, 'category') }

    if (filter.intent === 'count') {
      return { reply: composeReply({ intent: 'count', total, shown: 0, filter }), filter, total, summary, complaints: [], truncated: false }
    }

    const page = matched.slice(0, MAX_RESULTS)
    const users = page.length ? await findUsersByIds(page.map((r) => r.userId)) : new Map()
    return {
      reply: composeReply({ intent: 'list', total, shown: page.length, filter }),
      filter,
      total,
      summary,
      complaints: page.map((r) => toChatComplaint(r, users.get(r.userId))),
      truncated: total > page.length,
    }
  }

  return { answer }
}
