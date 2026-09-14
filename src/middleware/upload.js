import multer from 'multer'

// Memory storage: we no longer write files to disk. Every uploaded photo is
// resized/compressed (see utils/imageProcessor.js) and stored as a base64
// data URI directly on the Firestore complaint document, so all we need
// here is the raw buffer in memory before that conversion happens.
//
// The raw upload limit is generous (phone camera photos are often 3-8MB) -
// imageProcessor.js is responsible for compressing that down to something
// that safely fits Firestore's 1 MiB per-document limit, not this middleware.
function imageOnlyFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image uploads are allowed'))
  }
  cb(null, true)
}

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB raw upload ceiling
})
