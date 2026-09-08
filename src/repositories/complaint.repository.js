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
