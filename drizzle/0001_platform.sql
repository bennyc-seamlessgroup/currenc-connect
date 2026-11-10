CREATE TABLE IF NOT EXISTS cc_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  profile TEXT NOT NULL,
  activity TEXT NOT NULL DEFAULT '[]',
  onboarded INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_organizations (
  id TEXT PRIMARY KEY NOT NULL,
  company TEXT NOT NULL,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_memberships (
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  account_id TEXT NOT NULL REFERENCES cc_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,account_id)
);
CREATE TABLE IF NOT EXISTS cc_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  invited_by TEXT NOT NULL REFERENCES cc_accounts(id),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES cc_accounts(id),
  accept_nonce TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS cc_one_pending_invite ON cc_invitations(organization_id,email) WHERE status='pending';
CREATE INDEX IF NOT EXISTS cc_membership_account ON cc_memberships(account_id);
CREATE INDEX IF NOT EXISTS cc_invitation_email ON cc_invitations(email,status);
CREATE TABLE IF NOT EXISTS cc_team_audit (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  actor_id TEXT NOT NULL REFERENCES cc_accounts(id),
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
