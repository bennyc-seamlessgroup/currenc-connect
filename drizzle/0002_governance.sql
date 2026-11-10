CREATE TABLE IF NOT EXISTS cc_platform_admins (
  account_id TEXT PRIMARY KEY REFERENCES cc_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin')),
  granted_by TEXT REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cc_one_platform_owner ON cc_platform_admins(role) WHERE role='owner';
CREATE TABLE IF NOT EXISTS cc_account_controls (
  account_id TEXT PRIMARY KEY REFERENCES cc_accounts(id),
  status TEXT NOT NULL CHECK (status IN ('active','suspended')),
  reason TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES cc_accounts(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_company_status (
  organization_id TEXT PRIMARY KEY REFERENCES cc_organizations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','needs_info','approved','rejected','suspended')),
  application TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 0,
  was_approved INTEGER NOT NULL DEFAULT 0,
  approval_mode TEXT NOT NULL DEFAULT 'standard',
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reviewed_by TEXT REFERENCES cc_accounts(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO cc_company_status (organization_id,created_at)
SELECT id,created_at FROM cc_organizations WHERE 1=1 ON CONFLICT (organization_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cc_company_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('company','authority')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  application_revision INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cc_document_company ON cc_company_documents(organization_id,archived);
CREATE TABLE IF NOT EXISTS cc_company_submissions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  application_revision INTEGER NOT NULL,
  application TEXT NOT NULL,
  documents TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_company_reviews (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  application_revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  reviewed_by TEXT NOT NULL REFERENCES cc_accounts(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_campaign_controls (
  organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
  campaign_id TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES cc_accounts(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,campaign_id)
);
CREATE TABLE IF NOT EXISTS cc_portal_settings (
  id TEXT PRIMARY KEY,
  company_applications INTEGER NOT NULL DEFAULT 1,
  shareholder_registrations INTEGER NOT NULL DEFAULT 1,
  announcement TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO cc_portal_settings (id) VALUES ('portal') ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cc_platform_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES cc_accounts(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cc_platform_audit_date ON cc_platform_audit(created_at);
