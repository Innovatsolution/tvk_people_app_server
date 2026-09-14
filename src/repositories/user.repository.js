import { db, FieldValue } from '../config/firebase.js'

const usersCol = db.collection('users')

function toUser(doc) {
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() }
}

export async function findUserByMobile(mobile) {
  const snap = await usersCol.where('mobile', '==', mobile).limit(1).get()
  if (snap.empty) return null
  return toUser(snap.docs[0])
}

export async function findUserById(id) {
  const doc = await usersCol.doc(id).get()
  return toUser(doc)
}

export async function createUser({ username, email, mobile, passwordHash, ward, role }) {
  const ref = await usersCol.add({
    username,
    email: email || null,
    mobile,
    passwordHash,
    ward: ward || null,
    role: role || 'citizen',
    createdAt: FieldValue.serverTimestamp(),
  })
  return findUserById(ref.id)
}

export async function updateUser(id, patch) {
  await usersCol.doc(id).update({ ...patch, updatedAt: FieldValue.serverTimestamp() })
  return findUserById(id)
}

// Admin-facing: every user, newest first (sorted in Node - see the note in
// complaint.repository.js about avoiding composite-index requirements).
export async function listAllUsers() {
  const snap = await usersCol.get()
  const users = snap.docs.map(toUser)
  users.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
  return users
}

// Batch-fetch users by ID (used to attach requester info to admin complaint lists).
// Firestore's getAll() is the efficient way to fetch many docs by ID at once.
export async function findUsersByIds(ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (uniqueIds.length === 0) return new Map()

  const refs = uniqueIds.map((id) => usersCol.doc(id))
  const docs = await db.getAll(...refs)
  const map = new Map()
  docs.forEach((doc) => {
    const user = toUser(doc)
    if (user) map.set(doc.id, user)
  })
  return map
}

function toMillis(timestamp) {
  if (!timestamp) return 0
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  return new Date(timestamp).getTime()
}

export function stripSensitive(user) {
  if (!user) return user
  const { passwordHash, ...safe } = user
  return safe
}
