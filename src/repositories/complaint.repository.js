import { db, FieldValue } from '../config/firebase.js'

const complaintsCol = db.collection('complaints')

// Matches the 3 filter buckets used by the frontend's My Complaints screen.
const STATUS_GROUPS = {
  accepted_rejected: ['accepted', 'rejected'],
  pending: ['pending'],
  completed: ['completed'],
}

function toComplaint(doc) {
  if (!doc.exists) return null
  return { docId: doc.id, ...doc.data() }
}

function toMillis(timestamp) {
  if (!timestamp) return 0
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  return new Date(timestamp).getTime()
}

export async function createComplaint(data) {
  const ref = await complaintsCol.add({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return findComplaintByDocId(ref.id)
}

// Internal lookup by Firestore document ID (used right after creation).
async function findComplaintByDocId(docId) {
  const doc = await complaintsCol.doc(docId).get()
  return toComplaint(doc)
}

// Public lookup by the human-readable complaint ID, e.g. TVK_AZK_0001.
export async function findComplaintByDisplayId(displayId) {
  const snap = await complaintsCol.where('displayId', '==', displayId).limit(1).get()
  if (snap.empty) return null
  return toComplaint(snap.docs[0])
}

// Sorts newest-first in Node rather than via Firestore's orderBy(). This is
// deliberate: combining an equality filter (userId) or an 'in' filter (status)
// with orderBy() on a different field requires a Firestore composite index -
// Firestore will throw FAILED_PRECONDITION until that index is created. Since
// a single user's complaint list is small, sorting in memory avoids that
// index requirement entirely (and the manual-index-creation step it demands)
// for this app's scale.
export async function listComplaintsByUser(userId, statusFilter) {
  let query = complaintsCol.where('userId', '==', userId)

  if (statusFilter && statusFilter !== 'all') {
    const group = STATUS_GROUPS[statusFilter]
    if (!group) return []
    query = query.where('status', 'in', group)
  }

  const snap = await query.get()
  const complaints = snap.docs.map(toComplaint)
  complaints.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
  return complaints
}

export async function updateComplaintByDocId(docId, patch) {
  await complaintsCol.doc(docId).update({ ...patch, updatedAt: FieldValue.serverTimestamp() })
  return findComplaintByDocId(docId)
}

export async function countComplaintsByUser(userId) {
  const snap = await complaintsCol.where('userId', '==', userId).count().get()
  return snap.data().count
}

// Admin-facing: every complaint across every user. Deliberately fetches the
// whole collection unfiltered and does status/category/search matching in
// Node - the same reasoning as listComplaintsByUser above, but doubly so
// here: combining two or more separate Firestore filters (e.g. status +
// category) on different fields also triggers the composite-index
// requirement, so filtering in Node sidesteps that entirely. Fine at this
// app's scale; revisit if the complaints collection grows very large (see
// README's production checklist).
export async function listAllComplaints({ statusFilter, category, search } = {}) {
  const snap = await complaintsCol.get()
  let complaints = snap.docs.map(toComplaint)

  if (statusFilter && statusFilter !== 'all') {
    const group = STATUS_GROUPS[statusFilter] || [statusFilter]
    complaints = complaints.filter((c) => group.includes(c.status))
  }

  if (category) {
    complaints = complaints.filter((c) => c.category === category)
  }

  if (search) {
    const needle = search.trim().toLowerCase()
    complaints = complaints.filter(
      (c) =>
        c.displayId?.toLowerCase().includes(needle) ||
        c.title?.toLowerCase().includes(needle) ||
        c.ward?.toLowerCase().includes(needle)
    )
  }

  complaints.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
  return complaints
}

export async function countAllComplaintsByStatus() {
  // Individual single-field equality counts - each is covered by Firestore's
  // automatic single-field index, so none of these need a composite index.
  const statuses = ['submitted', 'accepted', 'rejected', 'pending', 'completed']
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const snap = await complaintsCol.where('status', '==', status).count().get()
      return [status, snap.data().count]
    })
  )
  return Object.fromEntries(counts)
}
