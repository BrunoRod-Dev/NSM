CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  password_hash text NOT NULL,
  recovery_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((used_by IS NULL) = (used_at IS NULL))
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE relationships (
  id uuid NOT NULL UNIQUE,
  low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('pending','accepted','removed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id),
  CHECK (requested_by IN (low_id, high_id))
);
CREATE INDEX relationships_high_idx ON relationships(high_id, status);
CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, target_id),
  CHECK (blocker_id <> target_id)
);
CREATE INDEX blocks_target_idx ON blocks(target_id);
CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latest_seq integer NOT NULL DEFAULT 0 CHECK (latest_seq >= 0),
  UNIQUE (low_id, high_id),
  CHECK (low_id < high_id)
);
CREATE INDEX conversations_high_idx ON conversations(high_id);
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  sender_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq),
  UNIQUE (sender_id, client_id)
);
CREATE INDEX invitations_unused_expiry_idx ON invitations(expires_at) WHERE used_by IS NULL;
