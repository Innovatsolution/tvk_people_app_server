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

export async function createUser({ username, email, mobile, passwordHash, ward }) {
  const ref = await usersCol.add({
    username,
    email: email || null,
    mobile,
    passwordHash,
    ward: ward || null,
    createdAt: FieldValue.serverTimestamp(),
  })
  return findUserById(ref.id)
}

export async function updateUser(id, patch) {
  await usersCol.doc(id).update({ ...patch, updatedAt: FieldValue.serverTimestamp() })
  return findUserById(id)
}

export function stripSensitive(user) {
  if (!user) return user
  const { passwordHash, ...safe } = user
  return safe
}
