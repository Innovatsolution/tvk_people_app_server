import { db } from '../config/firebase.js'

const COUNTER_REF = db.collection('counters').doc('complaints')

/**
 * Atomically increments the shared complaint counter and returns the next
 * sequence number. Using a Firestore transaction avoids two simultaneous
 * submissions ever getting the same ID.
 */
async function nextComplaintSequence() {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(COUNTER_REF)
    const current = snap.exists ? snap.data().seq || 0 : 0
    const next = current + 1
    tx.set(COUNTER_REF, { seq: next }, { merge: true })
    return next
  })
}

export function formatComplaintId(sequence) {
  return `TVK_AZK_${String(sequence).padStart(4, '0')}`
}

export async function generateComplaintId() {
  const sequence = await nextComplaintSequence()
  return formatComplaintId(sequence)
}
