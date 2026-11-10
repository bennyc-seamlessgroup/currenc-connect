ALTER TABLE cc_account_controls ADD COLUMN IF NOT EXISTS archived INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS cc_account_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  created_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES cc_accounts(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cc_pending_account_invitation ON cc_account_invitations(email) WHERE status='pending';
