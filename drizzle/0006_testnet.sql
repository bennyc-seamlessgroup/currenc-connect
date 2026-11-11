CREATE TABLE IF NOT EXISTS cc_testnet_campaigns (
 campaign_id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
 root TEXT NOT NULL,
 total_units TEXT NOT NULL,
 leaves TEXT NOT NULL,
 deployment_id TEXT NOT NULL,
 contract_address TEXT,
 deployment_block TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc_testnet_intents (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES cc_organizations(id),
 campaign_id TEXT NOT NULL,
 holder_id TEXT,
 account_id TEXT NOT NULL REFERENCES cc_accounts(id),
 kind TEXT NOT NULL,
 sender TEXT NOT NULL,
 payload TEXT NOT NULL,
 to_address TEXT,
 tx_hash TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'prepared',
 contract_address TEXT,
 block_number TEXT,
 block_hash TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cc_testnet_campaign_intents ON cc_testnet_intents(campaign_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS cc_testnet_active_claim ON cc_testnet_intents(campaign_id,holder_id) WHERE kind='claim' AND status<>'reverted';
