import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads')

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
    cb(null, `${Date.now()}_${safeBase}${ext}`)
  },
})

function imageOnlyFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image uploads are allowed'))
  }
  cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

export const uploadsDirPath = uploadsDir
