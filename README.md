# Simple Chat Backend

A chat backend built with **Node.js + TypeScript (strict)**, **PostgreSQL** and **Firebase Firestore**.

- **PostgreSQL** is the source of truth for **users, chats and chat membership** (relational data that needs constraints and joins).
- **Firestore** stores **messages, read receipts and last-seen pointers** (high write volume, append-heavy data that clients can also subscribe to in real time).

Supports 1:1 chats, sending messages, ordered message history with cursor pagination, read receipts and last-seen tracking. It also covers both bonus items: **group chats** (create, add/remove members, rename) and **message edit/delete**.

---

## Table of contents

- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Design decisions](#design-decisions)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Possible improvements](#possible-improvements)

---

## Tech stack

| Concern       | Choice                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| Runtime       | Node.js 20+, TypeScript with `strict` + `noUncheckedIndexedAccess`        |
| HTTP          | Express 5 (native async error handling), Helmet, CORS                     |
| Relational DB | PostgreSQL via `pg` (parameterised SQL, explicit transactions)            |
| Document DB   | Firebase Firestore via `firebase-admin`                                   |
| Validation    | Zod (request params, query, body and environment variables)               |
| Logging       | Pino + pino-http (structured JSON logs, request ids)                      |
| Testing       | Jest, ts-jest, Supertest                                                  |
| Quality       | ESLint (typescript-eslint, type-aware rules), Prettier, GitHub Actions CI |

## Architecture

The code is layered, and dependencies only point inwards:

```
HTTP request
   │
   ▼
Routes ──► Controllers ──► Services ──► Repositories ──► PostgreSQL / Firestore
           (validate +      (business     (data access,
            shape HTTP)      rules)        transactions)
```

- **Controllers** validate input with Zod and turn results into HTTP responses. They contain no business logic.
- **Services** hold the business rules: membership checks, admin permissions, and which store owns which data.
- **Repositories** are the only code that talks to a database. Messages sit behind a `MessageRepository` interface, so Firestore is an implementation detail and can be swapped for an in-memory version in tests.
- **`container.ts`** is the composition root that wires everything together. **`app.ts`** builds the Express app from those dependencies, which keeps it fully testable.
- Errors are typed domain errors (`NotFoundError`, `ForbiddenError`, ...). A single error middleware maps them to HTTP responses.

### Response format

Every response uses the same envelope:

```jsonc
// success
{ "success": true, "data": { ... } }

// error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
```

## Data model

### PostgreSQL

```
users                      chats                                chat_members
──────────────             ───────────────────────────          ─────────────────────────
id          uuid PK        id              uuid PK              chat_id   uuid FK → chats
name        varchar        type            'direct' | 'group'   user_id   uuid FK → users
created_at  timestamptz    name            varchar (groups)     role      'admin' | 'member'
updated_at  timestamptz    direct_key      varchar UNIQUE       joined_at timestamptz
                           created_by      uuid FK → users      PK (chat_id, user_id)
                           last_message_at timestamptz
                           created_at / updated_at
```

- `direct_key` is `"<smallerUserId>:<largerUserId>"`. Its `UNIQUE` constraint guarantees **exactly one 1:1 chat per pair of users**, even when requests race.
- A `CHECK` constraint enforces the shape of each chat type: direct chats have a `direct_key` and no name, group chats have a name.
- Indexes: `chat_members(user_id)` for listing a user's chats, plus an activity index used to sort chats by most recent message.

The schema lives in [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql). A small forward-only runner applies it, recording each migration in `schema_migrations`.

### Firestore

```
chats/{chatId}/messages/{messageId}
  chatId:     string
  senderId:   string
  text:       string | null          // null after delete (tombstone)
  createdAt:  Timestamp              // server timestamp – used for ordering
  editedAt:   Timestamp | null
  deletedAt:  Timestamp | null
  readBy:     { [userId]: Timestamp } // read receipts

chats/{chatId}/lastSeen/{userId}
  userId, messageId, messageCreatedAt, updatedAt
```

- Messages are a **sub-collection per chat**. Queries stay scoped to one chat, and no composite index is needed.
- Ordering uses the **server-assigned timestamp** (not the client or app-server clock), with the document id as a deterministic tie-breaker.
- Read receipts are a map on the message, so one read returns a message together with its receipts. Each receipt is written atomically as a single field path inside a transaction.

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 13+ (or Docker)
- A Firebase project with Firestore enabled **or** the Firestore emulator

### 1. Install

```bash
git clone https://github.com/Abhishek9812/simple-chat-task.git
cd simple-chat-task
npm install
cp .env.example .env
```

### 2. Start PostgreSQL (and optionally the Firestore emulator)

```bash
docker compose up -d postgres            # PostgreSQL on :5432
docker compose up -d firestore           # optional: Firestore emulator on :8080
```

To use the emulator, set `FIRESTORE_EMULATOR_HOST=localhost:8080` and `FIREBASE_PROJECT_ID=demo-chat` in `.env`. For a real Firebase project, provide service account credentials instead (see [Configuration](#configuration)).

### 3. Migrate, seed and run

```bash
npm run migrate      # create tables
npm run seed         # optional: creates demo users and prints their ids
npm run dev          # start with hot reload on http://localhost:3000
```

For production:

```bash
npm run build
npm run migrate:prod
npm start
```

A multi-stage `Dockerfile` is also included.

## Configuration

All environment variables are validated at startup. The process fails fast with a clear message if any is missing or invalid.

| Variable                         | Required | Default       | Description                                            |
| -------------------------------- | -------- | ------------- | ------------------------------------------------------ |
| `PORT`                           |          | `3000`        | HTTP port                                              |
| `NODE_ENV`                       |          | `development` | `development` enables pretty logs                      |
| `LOG_LEVEL`                      |          | `info`        | Pino log level                                         |
| `CORS_ORIGIN`                    |          | `*`           | `*` or comma-separated list of origins                 |
| `DATABASE_URL`                   | ✅       |               | PostgreSQL connection string                           |
| `DATABASE_POOL_MAX`              |          | `10`          | Max pool connections                                   |
| `DATABASE_SSL`                   |          | `false`       | Enable TLS for managed Postgres                        |
| `FIREBASE_PROJECT_ID`            | ✅       |               | Firebase / GCP project id                              |
| `FIREBASE_CLIENT_EMAIL`          |          |               | Service account email (inline credentials)             |
| `FIREBASE_PRIVATE_KEY`           |          |               | Service account private key (keep the `\n` escapes)    |
| `GOOGLE_APPLICATION_CREDENTIALS` |          |               | Path to a service account JSON (alternative to inline) |
| `FIRESTORE_EMULATOR_HOST`        |          |               | e.g. `localhost:8080` to use the local emulator        |

## API reference

Base URL: `http://localhost:3000`. All ids are UUIDs, except message ids, which are Firestore document ids.

> **Authentication is out of scope** for this task. As the spec describes, the acting user is passed in the request (`senderId`, `userId`, `actorId`). In production this would come from a verified auth token (e.g. Firebase Auth ID token) instead.

### Core endpoints

| #   | Method | Path                                    | Body / Query               | Description                       |
| --- | ------ | --------------------------------------- | -------------------------- | --------------------------------- |
| 1   | POST   | `/chat/create`                          | `{ userAId, userBId }`     | Create or get the 1:1 chat        |
| 2   | POST   | `/chat/:chatId/message/send`            | `{ senderId, text }`       | Send a message                    |
| 3   | GET    | `/chat/:chatId/messages`                | `?limit=50&before=<msgId>` | Messages ordered by timestamp     |
| 4   | POST   | `/chat/:chatId/message/:messageId/read` | `{ userId }`               | Mark a message as read            |
| 5   | POST   | `/chat/:chatId/lastseen`                | `{ userId, messageId }`    | Update user's last seen message   |
| 6   | GET    | `/user/:userId/chats`                   | `?limit=20&offset=0`       | List user's chats with member ids |

### Supporting & bonus endpoints

| Method | Path                               | Body                             | Description                              |
| ------ | ---------------------------------- | -------------------------------- | ---------------------------------------- |
| POST   | `/user/create`                     | `{ name }`                       | Create a user                            |
| GET    | `/user/:userId`                    |                                  | Get a user                               |
| GET    | `/chat/:chatId`                    |                                  | Chat details with members and roles      |
| GET    | `/chat/:chatId/lastseen`           |                                  | Last seen pointer of every member        |
| POST   | `/chat/group/create`               | `{ creatorId, name, memberIds }` | Create a group (creator becomes admin)   |
| PATCH  | `/chat/:chatId`                    | `{ actorId, name }`              | Rename group (admin only)                |
| POST   | `/chat/:chatId/members`            | `{ actorId, userIds }`           | Add members (admin only)                 |
| DELETE | `/chat/:chatId/members/:userId`    | `{ actorId }`                    | Remove member (admin) or leave (self)    |
| PATCH  | `/chat/:chatId/message/:messageId` | `{ userId, text }`               | Edit message (sender only)               |
| DELETE | `/chat/:chatId/message/:messageId` | `{ userId }`                     | Soft-delete message (sender only)        |
| GET    | `/health`, `/health/ready`         |                                  | Liveness / readiness (checks PostgreSQL) |

### Examples

**1. Create or get chat**

```bash
curl -X POST localhost:3000/chat/create \
  -H 'Content-Type: application/json' \
  -d '{"userAId":"<alice-id>","userBId":"<bob-id>"}'
```

```json
{ "success": true, "data": { "chatId": "6f1c…", "created": true } }
```

This returns `201` when the chat is created and `200` when it already existed. The order of the two users does not matter.

**2. Send message**

```bash
curl -X POST localhost:3000/chat/<chatId>/message/send \
  -H 'Content-Type: application/json' \
  -d '{"senderId":"<alice-id>","text":"Hello Bob!"}'
```

```json
{
  "success": true,
  "data": {
    "id": "Xk2l9…",
    "chatId": "6f1c…",
    "senderId": "<alice-id>",
    "text": "Hello Bob!",
    "createdAt": "2026-11-19T10:15:30.123Z",
    "editedAt": null,
    "deletedAt": null,
    "isDeleted": false,
    "readBy": {}
  }
}
```

**3. Get messages**

```bash
curl 'localhost:3000/chat/<chatId>/messages?limit=50'
```

```json
{ "success": true, "data": { "messages": [/* oldest → newest */], "nextCursor": "Xk2l9…" } }
```

This returns the **latest** `limit` messages (max 100) in chronological order. To load older history, pass `nextCursor` back as `before`. `nextCursor` is `null` when there are no older messages.

**4. Mark message read**

```bash
curl -X POST localhost:3000/chat/<chatId>/message/<messageId>/read \
  -H 'Content-Type: application/json' -d '{"userId":"<bob-id>"}'
```

```json
{
  "success": true,
  "data": {
    "chatId": "…",
    "messageId": "…",
    "userId": "<bob-id>",
    "readAt": "2026-11-19T10:16:02.000Z",
    "alreadyRead": false
  }
}
```

This call is idempotent: repeating it keeps the original `readAt`. Senders don't get a receipt on their own messages.

**5. Update last seen**

```bash
curl -X POST localhost:3000/chat/<chatId>/lastseen \
  -H 'Content-Type: application/json' -d '{"userId":"<bob-id>","messageId":"<messageId>"}'
```

```json
{
  "success": true,
  "data": {
    "updated": true,
    "lastSeen": {
      "userId": "<bob-id>",
      "messageId": "…",
      "messageCreatedAt": "…",
      "updatedAt": "…"
    }
  }
}
```

The pointer **only moves forward**. If a request names an older message than the stored one (for example, an out-of-order network retry), it is ignored and the response has `updated: false`.

**6. List user chats**

```bash
curl 'localhost:3000/user/<alice-id>/chats?limit=20&offset=0'
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "6f1c…",
        "type": "direct",
        "name": null,
        "memberIds": ["<alice-id>", "<bob-id>"],
        "createdBy": "<alice-id>",
        "lastMessageAt": "2026-11-19T10:15:30.123Z",
        "createdAt": "…",
        "updatedAt": "…"
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

Chats are sorted by most recent activity.

### Error codes

| HTTP | `error.code`            | When                                                |
| ---- | ----------------------- | --------------------------------------------------- |
| 400  | `VALIDATION_ERROR`      | Invalid params/query/body (field-level `details`)   |
| 400  | `INVALID_JSON`          | Malformed JSON body                                 |
| 400  | `BAD_REQUEST`           | Business rule violation (e.g. chat with yourself)   |
| 403  | `FORBIDDEN`             | Not a chat member / not an admin / not the sender   |
| 404  | `NOT_FOUND`             | User, chat or message does not exist                |
| 404  | `ROUTE_NOT_FOUND`       | Unknown endpoint                                    |
| 409  | `CONFLICT`              | Editing/deleting an already deleted message         |
| 500  | `INTERNAL_SERVER_ERROR` | Unexpected error (details are logged, never leaked) |

## Design decisions

- **Idempotent, race-safe "create or get" chat.** The endpoint does `INSERT … ON CONFLICT (direct_key) DO NOTHING` and then selects the existing row, all in one transaction. The database constraint, not application code, prevents duplicate chats. An e2e test fires 10 concurrent requests and asserts that exactly one chat is created.
- **Membership is enforced on every write.** Sending, marking read, updating last seen, editing and deleting all check membership in PostgreSQL first.
- **Server timestamps for ordering.** `FieldValue.serverTimestamp()` makes ordering independent of clock drift between app servers.
- **Firestore transactions for read-modify-write.** Read receipts, last-seen updates and edit/delete authorisation run inside transactions. That makes them atomic and idempotent under concurrent requests.
- **Forward-only last seen.** It compares `(createdAt, messageId)` using the same ordering as the message query, so unread counts never jump backwards.
- **Soft delete with tombstones.** A deleted message keeps its position, so ordering, pagination cursors and receipts stay consistent. Only the text is cleared.
- **Cross-store consistency.** The message is committed to Firestore first. Then `chats.last_message_at` in PostgreSQL is updated on a best-effort basis: that value only drives sorting, so a failure is logged and never fails a successful send.
- **Group admin continuity.** If the last admin leaves, the longest-standing member is promoted automatically. This happens in a transaction that holds a row lock on the chat.
- **Fail fast configuration.** The environment is validated with Zod at boot.
- **Operational basics.** The service has structured logs with an `x-request-id`, liveness and readiness probes, graceful shutdown (drains HTTP, closes the pool and Firestore), Helmet security headers and a JSON body size limit.

## Testing

```bash
npm test                 # unit + HTTP tests (no external services needed)
npm run test:coverage
```

| Suite                                | What it covers                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `tests/unit/chat.service.test.ts`    | Chat rules: self-chat, user existence, membership, admin permissions                                 |
| `tests/unit/message.service.test.ts` | Ordering and pagination, idempotent receipts, forward-only last seen, edit/delete rules              |
| `tests/integration/routes.test.ts`   | Routing, validation, status codes and error mapping (Supertest)                                      |
| `tests/integration/api.e2e.test.ts`  | Full API flow against **real PostgreSQL**, including the concurrent create race and group management |

The e2e suite is opt-in, because it needs a disposable database:

```bash
docker compose up -d postgres
docker compose exec postgres createdb -U chat chat_test
TEST_DATABASE_URL=postgres://chat:chat@localhost:5432/chat_test npm test
```

In the e2e suite, Firestore is replaced by an in-memory `MessageRepository` that follows the same contract. CI (GitHub Actions) runs format, lint, typecheck, build and all tests, including the e2e suite against a Postgres service container.

Other quality scripts: `npm run lint`, `npm run typecheck`, `npm run format:check`.

## Project structure

```
├── migrations/                 # SQL migrations (applied in order)
├── scripts/seed.ts             # demo users
├── src/
│   ├── app.ts                  # Express app factory (middlewares, routes, errors)
│   ├── container.ts            # composition root / dependency wiring
│   ├── server.ts               # bootstrap + graceful shutdown
│   ├── config/                 # env validation, logger
│   ├── common/                 # domain errors, HTTP helpers, shared schemas
│   ├── db/                     # Postgres pool & transactions, Firestore init, migration runner
│   ├── middlewares/            # error & 404 handlers
│   └── modules/
│       ├── users/              # repository, service, controller, schemas, routes
│       ├── chats/              # direct + group chats (PostgreSQL)
│       └── messages/           # messages, receipts, last seen (Firestore)
└── tests/
    ├── unit/
    ├── integration/
    └── helpers/                # in-memory MessageRepository, silent logger
```

## Possible improvements

- Authentication (Firebase Auth / JWT) so that the acting user comes from the token, not the request body.
- Real-time delivery: clients can subscribe to `chats/{chatId}/messages` with Firestore listeners, protected by Firestore security rules. Alternatively, add a WebSocket gateway.
- Unread counts per chat, derived from the `lastSeen` pointer.
- Rate limiting and per-user message throttling.
- Outbox/retry for the `last_message_at` cross-store update.
- An OpenAPI/Swagger spec generated from the Zod schemas.
