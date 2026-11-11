CREATE TABLE IF NOT EXISTS cc_holding_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  campaign_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES cc_accounts(id),
  version INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,holder_id,version)
);
CREATE INDEX IF NOT EXISTS cc_holding_evidence_owner ON cc_holding_evidence(account_id,organization_id,holder_id);
CREATE TABLE IF NOT EXISTS cc_holding_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  evidence_id TEXT NOT NULL UNIQUE REFERENCES cc_holding_evidence(id),
  actor_id TEXT NOT NULL REFERENCES cc_accounts(id),
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  shares INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL
);
