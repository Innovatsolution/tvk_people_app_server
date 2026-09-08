import { db } from '../config/firebase.js'

const wardOfficersCol = db.collection('wardOfficers')

function toWardOfficer(doc) {
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() }
}

// Ward officer docs are keyed by ward name for simple, direct lookup.
export async function findWardOfficerByWard(ward) {
  if (!ward) return null
  const doc = await wardOfficersCol.doc(ward).get()
  return toWardOfficer(doc)
}

export async function upsertWardOfficer(ward, data) {
  await wardOfficersCol.doc(ward).set(data, { merge: true })
  return findWardOfficerByWard(ward)
}
