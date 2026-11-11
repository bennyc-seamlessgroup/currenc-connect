CREATE TABLE IF NOT EXISTS cc_internal_accounts (
  account_id TEXT PRIMARY KEY REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
INSERT INTO cc_internal_accounts (account_id,created_at)
SELECT account_id,created_at FROM cc_platform_admins WHERE 1=1 ON CONFLICT (account_id) DO NOTHING;
INSERT INTO cc_internal_accounts (account_id,created_at)
SELECT p.target_id,MIN(p.created_at) FROM cc_platform_audit p
WHERE p.action IN ('Platform admin granted','Platform owner initialized')
AND EXISTS (SELECT 1 FROM cc_accounts a WHERE a.id=p.target_id)
GROUP BY p.target_id ON CONFLICT (account_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cc_managed_airdrops (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','changes_requested','approved','cancelled','archived')),
  data TEXT NOT NULL,
  summary TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  manifest_hash TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cc_airdrop_company ON cc_managed_airdrops(organization_id,created_at);
CREATE TABLE IF NOT EXISTS cc_airdrop_versions (
  airdrop_id TEXT NOT NULL REFERENCES cc_managed_airdrops(id),
  version INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  manifest TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (airdrop_id,version)
);
CREATE TABLE IF NOT EXISTS cc_airdrop_events (
  id TEXT PRIMARY KEY,
  airdrop_id TEXT NOT NULL REFERENCES cc_managed_airdrops(id),
  actor_id TEXT NOT NULL REFERENCES cc_accounts(id),
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_custody_wallets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  provider TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL,
  UNIQUE (network,address)
);
CREATE TABLE IF NOT EXISTS cc_custody_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  wallet_id TEXT NOT NULL REFERENCES cc_custody_wallets(id),
  token_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,wallet_id,token_address)
);
