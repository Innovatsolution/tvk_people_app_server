// Creates a new admin account, or promotes an existing user to admin if the
// mobile number is already registered.
//
// Usage:
//   node scripts/createAdmin.js <mobile> <password> <username>
//   node scripts/createAdmin.js 9999999999 someStrongPassword "Admin Name"
//
// If <mobile> already exists, <password> and <username> are ignored and the
// existing account is simply promoted to role: 'admin'.
import bcrypt from 'bcryptjs'
import { findUserByMobile, createUser, updateUser } from '../src/repositories/user.repository.js'

const [, , mobile, password, username] = process.argv

async function main() {
  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
    console.error('Usage: node scripts/createAdmin.js <10-digit-mobile> <password> <username>')
    process.exit(1)
  }

  const existing = await findUserByMobile(mobile)

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`• ${mobile} is already an admin. Nothing to do.`)
    } else {
      await updateUser(existing.id, { role: 'admin' })
      console.log(`✓ Promoted existing user ${mobile} (${existing.username}) to admin.`)
    }
    process.exit(0)
  }

  if (!password || password.length < 6) {
    console.error('New admin accounts need a password of at least 6 characters.')
    process.exit(1)
  }
  if (!username) {
    console.error('New admin accounts need a username (pass it as the 3rd argument).')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await createUser({ username, email: null, mobile, passwordHash, ward: null, role: 'admin' })
  console.log(`✓ Created admin account for ${mobile} (${user.username}).`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to create/promote admin:', err)
  process.exit(1)
})
