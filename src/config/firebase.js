import admin from 'firebase-admin'
import { env } from './env.js'

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.firebase.projectId,
      clientEmail: env.firebase.clientEmail,
      privateKey: env.firebase.privateKey,
    }),
  })
}

export const db = admin.firestore()
export const FieldValue = admin.firestore.FieldValue
export { admin }
