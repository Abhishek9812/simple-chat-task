-- Users and chats live in PostgreSQL. Messages and read receipts live in Firestore.

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE chat_type AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE chat_member_role AS ENUM ('admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS chats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             chat_type NOT NULL,
  name             VARCHAR(100),
  -- Deterministic "<smallerUserId>:<largerUserId>" key for 1:1 chats. The UNIQUE
  -- constraint guarantees a single direct chat per user pair, even under races.
  direct_key       VARCHAR(73) UNIQUE,
  created_by       UUID NOT NULL REFERENCES users(id),
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chats_type_shape_chk CHECK (
    (type = 'direct' AND direct_key IS NOT NULL AND name IS NULL)
    OR (type = 'group' AND direct_key IS NULL AND name IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       chat_member_role NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- "List chats for a user" looks members up by user_id.
CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members (user_id);
-- Chats are listed by most recent activity.
CREATE INDEX IF NOT EXISTS idx_chats_activity ON chats ((COALESCE(last_message_at, created_at)) DESC);
