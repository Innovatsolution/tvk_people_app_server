import sharp from 'sharp'
import { ApiError } from './apiError.js'

const MAX_DIMENSION = 1200 // px, longest edge - phone photos are far larger than needed for this use case
const QUALITY_STEPS = [75, 60, 45, 30] // JPEG quality attempts, highest first

// Each complaint document can hold up to two of these (before + after), plus
// its text fields, all under Firestore's 1 MiB per-document limit. Budgeting
// ~350KB base64 per image keeps two images comfortably under that with
// plenty of headroom for everything else (which is only a few KB of text).
const MAX_BASE64_BYTES = 350 * 1024

/**
 * Converts an uploaded image buffer into a base64 data URI, resizing and
 * compressing it as needed to fit MAX_BASE64_BYTES. Throws a friendly
 * ApiError if even the most aggressive compression doesn't fit (rare -
 * would need an unusually large/detailed source image).
 */
export async function processImageToBase64(buffer) {
  for (const quality of QUALITY_STEPS) {
    const output = await sharp(buffer)
      .rotate() // respect the original EXIF orientation before stripping metadata
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()

    const base64 = output.toString('base64')
    if (base64.length <= MAX_BASE64_BYTES) {
      return `data:image/jpeg;base64,${base64}`
    }
  }

  throw ApiError.badRequest(
    'This image is too large or detailed to store even after compression. Please try a smaller or simpler photo.'
  )
}
