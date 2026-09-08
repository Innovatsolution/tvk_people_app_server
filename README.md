# TVK Complaint API (Express + Firestore)

Backend for the TVK complaint-tracking app: auth, complaint filing/tracking,
dashboard summary, and ward officer lookup, all backed by Firebase Firestore.

## 1. Set up Firebase credentials

**If you ever pasted a real service-account key anywhere outside your own
`.env` file (including in chat with an AI assistant), rotate it first:**
Firebase Console → Project Settings → Service Accounts → Generate new
private key, then delete the old key from that same list.

Once you have a fresh key:

```bash
cp .env.example .env
```

Open `.env` and fill in the three Firebase fields from the downloaded JSON:

| .env variable            | JSON field       |
|---------------------------|------------------|
| `FIREBASE_PROJECT_ID`     | `project_id`     |
| `FIREBASE_CLIENT_EMAIL`   | `client_email`   |
| `FIREBASE_PRIVATE_KEY`    | `private_key`    |

Paste `private_key` exactly as it appears in the JSON (it already contains
literal `\n` sequences) wrapped in double quotes on a single line. Also set
`JWT_SECRET` to a long random string (e.g. `openssl rand -hex 32`).

**Never commit `.env`** — it's already in `.gitignore`.

## 2. Install and run

```bash
npm install
npm run seed   # creates a ward officer + a demo user/complaints (safe to re-run)
npm run dev    # starts on http://localhost:4000 with auto-reload
```

The seed script creates a demo login:
- Mobile: `9876543210`
- Password: `password123`

## 3. Point the frontend at it

In the React app, add a `.env` with:
```
VITE_API_BASE_URL=http://localhost:4000/api
```
and replace the `// TODO` fetch calls in `Login.jsx`, `Signup.jsx`,
`ForgotPassword.jsx`, `Home.jsx`, `MyComplaints.jsx`, and `NewComplaint.jsx`
with real `fetch`/`axios` calls to the endpoints below, storing the returned
`token` (e.g. in memory or `sessionStorage`) and sending it as
`Authorization: Bearer <token>` on every subsequent request.

## Data model (Firestore collections)

- **`users`** — `{ username, email, mobile, passwordHash, ward, createdAt }`
- **`complaints`** — `{ displayId, userId, category, title, description, ward, status, statusTimestamps, beforeImagePath, afterImagePath, rejectReason, createdAt, updatedAt }`
- **`wardOfficers`** — doc ID = ward name, `{ name, role, ward, phone }`
- **`counters/complaints`** — `{ seq }`, used to generate sequential `TVK_AZK_0001`-style IDs

`status` is one of: `submitted` (just filed, awaiting review) → `accepted` /
`rejected` → `pending` (being worked on) → `completed`. The frontend's 3-step
tracker (Accepted/Rejected → Pending → Completed) is built server-side by
`src/utils/statusSteps.js` from `status` + `statusTimestamps`, so the API
response shape matches `StatusTracker`/`MiniProgress` exactly.

## API reference

All endpoints are prefixed with `/api`. Protected routes require
`Authorization: Bearer <token>`.

### Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/signup` | `username, email?, mobile, password, confirmPassword, ward?` | Returns `{ token, user }` |
| POST | `/auth/login` | `mobile, password` | Returns `{ token, user }` |
| POST | `/auth/forgot-password` | `mobile, newPassword, confirmPassword` | Resets password directly — **add OTP verification before production** |
| GET | `/auth/me` | — | Sanity-check a token, returns `{ user }` |

### Users
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/users/me` | — | Current profile |
| PATCH | `/users/me` | any of `username, email, ward` | Partial update |

### Complaints
| Method | Path | Body / Query | Notes |
|---|---|---|---|
| GET | `/complaints` | `?status=all\|accepted_rejected\|pending\|completed` | List current user's complaints |
| GET | `/complaints/:id` | — | `:id` is the `TVK_AZK_0001`-style display ID |
| POST | `/complaints` | multipart: `category, title, description, ward` + file `beforeImage` | Creates complaint, status starts as `submitted` |
| PATCH | `/complaints/:id/status` | multipart: `status, rejectReason?` + file `afterImage` | Ward-officer action — add role checks before production |

### Dashboard
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | Returns `{ user, totalComplaints, currentComplaint, wardOfficer }` — everything the Home screen needs in one call |

### Ward officer
| Method | Path | Notes |
|---|---|---|
| GET | `/ward-officer` | Officer for the current user's own ward |

### Misc
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness check, no auth |

Uploaded photos are served statically at `/uploads/<filename>` (absolute
URLs are built using `PUBLIC_BASE_URL`).

## Production checklist (not done yet, by design — this is a working starting point)

- Add OTP verification to `/auth/forgot-password` (and ideally to signup mobile
  verification) before trusting mobile-number-only password resets.
- Add a `role` field to users and restrict `PATCH /complaints/:id/status` to
  ward-officer/admin roles only.
- Consider Firebase Storage instead of local disk for uploaded photos if you
  deploy somewhere without persistent disk (e.g. serverless).
- Add Firestore composite indexes if prompted — filtering by `status` while
  ordering by `createdAt` needs one; Firestore's error message includes a
  direct link to create it the first time you hit that query in production.
- Rate-limit `/auth/login` and `/auth/forgot-password` to slow brute-forcing.
