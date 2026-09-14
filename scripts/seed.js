// Run with: npm run seed
// Safe to re-run - it upserts the ward officer and skips creating the demo
// user/complaints if they already exist.
import bcrypt from 'bcryptjs'
import { FieldValue } from '../src/config/firebase.js'
import { findUserByMobile, createUser } from '../src/repositories/user.repository.js'
import { listComplaintsByUser } from '../src/repositories/complaint.repository.js'
import { upsertWardOfficer } from '../src/repositories/wardOfficer.repository.js'
import { generateComplaintId } from '../src/utils/idGenerator.js'
import { db } from '../src/config/firebase.js'

const WARD = '15வது வார்டு, ஆழ்வார்குறிச்சி'
const DEMO_MOBILE = '9876543210'
const DEMO_PASSWORD = 'password123'
const ADMIN_MOBILE = '9999999999'
const ADMIN_PASSWORD = 'admin12345'

async function seedWardOfficer() {
  await upsertWardOfficer(WARD, {
    name: 'திரு. முருகன்',
    role: 'வார்டு பொறுப்பாளர்',
    ward: WARD,
    phone: '9876500000',
  })
  console.log(`✓ Ward officer upserted for "${WARD}"`)
}

async function seedDemoUserAndComplaints() {
  let user = await findUserByMobile(DEMO_MOBILE)

  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
    user = await createUser({
      username: 'ஜோ செல்வர்ஷன்',
      email: null,
      mobile: DEMO_MOBILE,
      passwordHash,
      ward: WARD,
      role: 'citizen',
    })
    console.log(`✓ Demo user created (mobile: ${DEMO_MOBILE}, password: ${DEMO_PASSWORD})`)
  } else {
    console.log('• Demo user already exists, skipping creation')
  }

  const existingComplaints = await listComplaintsByUser(user.id, 'all')
  if (existingComplaints.length > 0) {
    console.log('• Demo user already has complaints, skipping complaint seed')
    return
  }

  const now = new Date()
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  const complaintsToSeed = [
    {
      category: 'water',
      title: 'குடிநீர் குழாய் கசிவு',
      description: 'சாலையோர குடிநீர் குழாயில் இருந்து தண்ணீர் தொடர்ந்து கசிகிறது.',
      ward: WARD,
      status: 'pending',
      statusTimestamps: { reviewedAt: daysAgo(1), pendingAt: daysAgo(0) },
      beforeImageBase64: null,
      afterImageBase64: null,
      rejectReason: null,
      createdAt: daysAgo(1),
    },
    {
      category: 'waste',
      title: 'குப்பை அகற்றப்படவில்லை',
      description: 'ஒரு வாரமாக குப்பை அகற்றப்படவில்லை.',
      ward: WARD,
      status: 'rejected',
      statusTimestamps: { reviewedAt: daysAgo(2) },
      beforeImageBase64: null,
      afterImageBase64: null,
      rejectReason: 'இந்த பகுதி தனியார் நிலம் என அடையாளம் காணப்பட்டது.',
      createdAt: daysAgo(3),
    },
    {
      category: 'light',
      title: 'விளக்கு வேலை செய்யவில்லை',
      description: 'தெரு விளக்கு ஒரு வாரமாக வேலை செய்யவில்லை.',
      ward: WARD,
      status: 'accepted',
      statusTimestamps: { reviewedAt: daysAgo(5) },
      beforeImageBase64: null,
      afterImageBase64: null,
      rejectReason: null,
      createdAt: daysAgo(6),
    },
    {
      category: 'road',
      title: 'சாலை சேதம்',
      description: 'பெரிய குழி ஏற்பட்டு வாகனங்கள் சேதமடைகின்றன.',
      ward: WARD,
      status: 'completed',
      statusTimestamps: { reviewedAt: daysAgo(8), pendingAt: daysAgo(7), completedAt: daysAgo(6) },
      beforeImageBase64: null,
      afterImageBase64: null,
      rejectReason: null,
      createdAt: daysAgo(9),
    },
  ]

  for (const c of complaintsToSeed) {
    const displayId = await generateComplaintId()
    await db.collection('complaints').add({
      displayId,
      userId: user.id,
      ...c,
      createdAt: c.createdAt,
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`✓ Seeded complaint ${displayId} (${c.status})`)
  }
}

async function seedDemoAdmin() {
  const existing = await findUserByMobile(ADMIN_MOBILE)
  if (existing) {
    console.log('• Demo admin already exists, skipping creation')
    return
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  await createUser({
    username: 'Admin',
    email: null,
    mobile: ADMIN_MOBILE,
    passwordHash,
    ward: null,
    role: 'admin',
  })
  console.log(`✓ Demo admin created (mobile: ${ADMIN_MOBILE}, password: ${ADMIN_PASSWORD})`)
}

async function main() {
  await seedWardOfficer()
  await seedDemoUserAndComplaints()
  await seedDemoAdmin()
  console.log('\nSeed complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
