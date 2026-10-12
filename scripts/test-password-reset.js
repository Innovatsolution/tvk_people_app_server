// Run with: npm run test:otp
// Exercises the forgot-password rules against an in-memory user store - no
// Firestore or network needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

// env.js / firebase.js read these at import time. Throwaway values only.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
process.env.JWT_SECRET = 'unit-test-secret'
process.env.FIREBASE_PROJECT_ID = 'unit-test'
process.env.FIREBASE_CLIENT_EMAIL = 'unit-test@unit-test.iam.gserviceaccount.com'
process.env.FIREBASE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n')

const { createPasswordResetService } = await import('../src/services/passwordReset.service.js')
const { signResetToken, verifyResetToken, signToken } = await import('../src/utils/token.js')
const { stripSensitive } = await import('../src/repositories/user.repository.js')

const MOBILE = '9876543210'
const OTP_FIELDS = ['resetOtp', 'resetOtpExpiresAt', 'resetOtpAttempts', 'resetOtpRequestedAt']

function setup({ returnInResponse = true, maxAttempts = 3 } = {}) {
  const db = new Map()
  db.set('u1', { id: 'u1', username: 'Test', mobile: MOBILE, passwordHash: bcrypt.hashSync('oldpassword', 4) })

  const users = {
    findByMobile: async (m) => [...db.values()].find((u) => u.mobile === m) || null,
    findById: async (id) => db.get(id) || null,
    update: async (id, patch) => { Object.assign(db.get(id), patch) },
    clearResetOtp: async (id) => { OTP_FIELDS.forEach((f) => delete db.get(id)[f]) },
  }

  const clock = { t: 1_000_000 }
  const delivered = []
  const service = createPasswordResetService({
    users,
    config: { expiryMinutes: 5, maxAttempts, resendSeconds: 30, returnInResponse },
    signResetToken,
    verifyResetToken,
    deliverOtp: async (mobile, otp) => { delivered.push({ mobile, otp }) },
    now: () => clock.t,
    generateOtp: (() => { let n = 0; return () => String(111111 * (++n)).padStart(6, '0').slice(0, 6) })(),
    hashPassword: async (p) => bcrypt.hash(p, 4),
  })
  return { service, db, clock, delivered }
}

async function rejects(promise, code, status) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code)
    if (status) assert.equal(err.statusCode, status)
    return true
  })
}

test('request-otp: unknown mobile number is rejected', async () => {
  const { service } = setup()
  await rejects(service.requestOtp('9000000000'), 'MOBILE_NOT_FOUND', 404)
})

test('request-otp: stores the OTP on that user, delivers it, and returns it when configured to', async () => {
  const { service, db, delivered } = setup()
  const res = await service.requestOtp(MOBILE)
  assert.equal(res.otp, '111111')
  assert.equal(db.get('u1').resetOtp, '111111')
  assert.equal(db.get('u1').resetOtpAttempts, 0)
  assert.equal(db.get('u1').resetOtpExpiresAt, 1_000_000 + 5 * 60 * 1000)
  assert.deepEqual(delivered, [{ mobile: MOBILE, otp: '111111' }])
  assert.equal(res.expiresInSeconds, 300)
})

test('request-otp: the OTP is NOT returned when returnInResponse is off, but is still stored + delivered', async () => {
  const { service, db, delivered } = setup({ returnInResponse: false })
  const res = await service.requestOtp(MOBILE)
  assert.equal('otp' in res, false)
  assert.equal(db.get('u1').resetOtp, '111111')
  assert.equal(delivered.length, 1)
})

test('request-otp: resending is blocked during the cooldown, then replaces the OTP and resets attempts', async () => {
  const { service, db, clock } = setup()
  await service.requestOtp(MOBILE)
  clock.t += 10_000
  await assert.rejects(service.requestOtp(MOBILE), (e) => {
    assert.equal(e.code, 'OTP_COOLDOWN')
    assert.equal(e.statusCode, 429)
    assert.equal(e.details.retryAfterSeconds, 20)
    return true
  })
  db.get('u1').resetOtpAttempts = 2
  clock.t += 20_000
  const res = await service.requestOtp(MOBILE)
  assert.equal(res.otp, '222222')
  assert.equal(db.get('u1').resetOtp, '222222')
  assert.equal(db.get('u1').resetOtpAttempts, 0)
})

test('verify-otp: wrong OTP reports attempts left, and the limit locks the OTP out', async () => {
  const { service, db, clock } = setup({ maxAttempts: 3 })
  await service.requestOtp(MOBILE)
  await assert.rejects(service.verifyOtp(MOBILE, '000000'), (e) => {
    assert.equal(e.code, 'OTP_INVALID'); assert.equal(e.details.attemptsLeft, 2); return true
  })
  await assert.rejects(service.verifyOtp(MOBILE, '000001'), (e) => {
    assert.equal(e.details.attemptsLeft, 1); return true
  })
  await rejects(service.verifyOtp(MOBILE, '000002'), 'OTP_TOO_MANY_ATTEMPTS', 429)
  assert.equal(db.get('u1').resetOtp, null)
  // even the right OTP no longer works - a fresh one must be requested
  await rejects(service.verifyOtp(MOBILE, '111111'), 'OTP_NOT_REQUESTED', 400)
  // ...and the resend cooldown still applies after a lockout, so guessing can't just restart instantly
  await rejects(service.requestOtp(MOBILE), 'OTP_COOLDOWN', 429)
  clock.t += 30_000
  assert.equal((await service.requestOtp(MOBILE)).otp, '222222')
})

test('verify-otp: an expired OTP is rejected and cleared', async () => {
  const { service, db, clock } = setup()
  await service.requestOtp(MOBILE)
  clock.t += 5 * 60 * 1000 + 1
  await rejects(service.verifyOtp(MOBILE, '111111'), 'OTP_EXPIRED', 400)
  assert.equal(db.get('u1').resetOtp, undefined)
})

test('verify-otp: no OTP requested yet', async () => {
  const { service } = setup()
  await rejects(service.verifyOtp(MOBILE, '123456'), 'OTP_NOT_REQUESTED', 400)
})

test('verify-otp: the correct OTP issues a reset token and is single-use', async () => {
  const { service, db } = setup()
  await service.requestOtp(MOBILE)
  const { resetToken } = await service.verifyOtp(MOBILE, '111111')
  assert.ok(resetToken)
  OTP_FIELDS.forEach((f) => assert.equal(db.get('u1')[f], undefined))
  await rejects(service.verifyOtp(MOBILE, '111111'), 'OTP_NOT_REQUESTED', 400)
})

test('reset: updates that user\'s password, and the reset token works only once', async () => {
  const { service, db } = setup()
  await service.requestOtp(MOBILE)
  const { resetToken } = await service.verifyOtp(MOBILE, '111111')

  await service.resetPassword(resetToken, 'brandNewPass1')
  assert.equal(await bcrypt.compare('brandNewPass1', db.get('u1').passwordHash), true)
  assert.equal(await bcrypt.compare('oldpassword', db.get('u1').passwordHash), false)

  await rejects(service.resetPassword(resetToken, 'anotherPass2'), 'RESET_TOKEN_INVALID', 401)
  assert.equal(await bcrypt.compare('brandNewPass1', db.get('u1').passwordHash), true)
})

test('reset: garbage tokens and ordinary login tokens are rejected', async () => {
  const { service } = setup()
  await rejects(service.resetPassword('not-a-token', 'whatever1'), 'RESET_TOKEN_INVALID', 401)
  await rejects(service.resetPassword(signToken('u1'), 'whatever1'), 'RESET_TOKEN_INVALID', 401)
})

test('a reset token can never be used as a login session', async () => {
  const { service } = setup()
  await service.requestOtp(MOBILE)
  const { resetToken } = await service.verifyOtp(MOBILE, '111111')
  // requireAuth verifies login tokens with JWT_SECRET - this must fail
  assert.throws(() => jwt.verify(resetToken, process.env.JWT_SECRET))
})

test('stripSensitive never exposes the password hash or any OTP field', () => {
  const safe = stripSensitive({
    id: 'u1', username: 'Test', mobile: MOBILE, passwordHash: 'x',
    resetOtp: '123456', resetOtpExpiresAt: 1, resetOtpAttempts: 0, resetOtpRequestedAt: 1,
  })
  assert.deepEqual(Object.keys(safe).sort(), ['id', 'mobile', 'username'])
})

// firebase-admin is imported (never connected to) for stripSensitive; don't let it hold the process open
test.after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref())
