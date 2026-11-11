CREATE TABLE IF NOT EXISTS cc_wallet_challenges (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES cc_accounts(id),
 session_hash TEXT NOT NULL,
 origin TEXT NOT NULL,
 chain TEXT NOT NULL,
 address TEXT NOT NULL,
 address_key TEXT NOT NULL,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS cc_wallet_challenge_owner ON cc_wallet_challenges(account_id,created_at);
CREATE TABLE IF NOT EXISTS cc_verified_wallets (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES cc_accounts(id),
 chain TEXT NOT NULL,
 address TEXT NOT NULL,
 address_key TEXT NOT NULL,
 verified_at TEXT NOT NULL,
 verification_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 revoked_at TEXT,
 UNIQUE(account_id,chain,address_key)
);
CREATE TABLE IF NOT EXISTS cc_wallet_proofs (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES cc_accounts(id),
 wallet_id TEXT NOT NULL,
 challenge_id TEXT NOT NULL UNIQUE,
 chain TEXT NOT NULL,
 address TEXT NOT NULL,
 message TEXT NOT NULL,
 signature TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cc_wallet_proof_owner ON cc_wallet_proofs(account_id,created_at);
CREATE TABLE IF NOT EXISTS cc_wallet_audit (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES cc_accounts(id),
 action TEXT NOT NULL,
 detail TEXT NOT NULL,
 created_at TEXT NOT NULL
);
