import {neon} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';

// Keep the existing Worker query contract and optimistic revision lock.
const statements = new Map([
  ['INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)',
   'INSERT INTO currenc_connect_workspaces (id, data, revision) VALUES ($1, $2, 0) ON CONFLICT (id) DO NOTHING RETURNING id'],
  ['SELECT data, revision FROM demo_workspaces WHERE id = ?',
   'SELECT data, revision FROM currenc_connect_workspaces WHERE id = $1'],
  ['UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?',
   'UPDATE currenc_connect_workspaces SET data = $1, revision = revision + 1 WHERE id = $2 AND revision = $3 RETURNING revision'],
]);
const databases = new Map();
export function createNeonDatabase(query,transaction) {
  return {dialect:'postgres',query,transaction,async atomicChange(change,effects=[]) {
    const values=[...change.values];
    const ctes=effects.map((effect,index)=>{const offset=values.length;values.push(...effect.values);return `effect_${index} AS (${effect.sql.replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)+offset))})`;});
    return query(`WITH changed AS (${change.sql})${ctes.length?', '+ctes.join(', '):''} SELECT * FROM changed`,values);
  },async mutateWithAudit(change,audit) {
    const offset=change.values.length;
    const parameters=audit.values.map((_,index)=>'$'+(offset+index+1)).join(',');
    return query(`WITH changed AS (${change.sql}), audited AS (INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT ${parameters} FROM changed RETURNING id) SELECT * FROM changed`,[...change.values,...audit.values]);
  },async adoptWorkspace(legacyId,accountId) {
    try {
      const rows=await query('UPDATE currenc_connect_workspaces SET id = $1 WHERE id = $2 AND NOT EXISTS (SELECT 1 FROM currenc_connect_workspaces WHERE id = $1) RETURNING id',[accountId,legacyId]);
      return rows.length===1;
    } catch(error) {
      // Another browser may have initialized the same account concurrently.
      if(error.code==='23505')return false;
      throw error;
    }
  },prepare(statement) {
    const sql = statements.get(statement);
    if (!sql) throw new Error('Unsupported workspace query');
    let values = [];
    return {
      bind(...args) { values=args; return this; },
      async first() { return (await query(sql,values))[0] || null; },
      async run() { return {meta:{changes:(await query(sql,values)).length}}; },
    };
  }};
}
export async function getCloudDatabase(connectionString) {
  if (!databases.has(connectionString)) {
    const ready = (async()=>{
      const sql = neon(connectionString);
      const schema=await readFile(new URL('../drizzle/0001_platform.sql',import.meta.url),'utf8');
      const governance=await readFile(new URL('../drizzle/0002_governance.sql',import.meta.url),'utf8');
      const accounts=await readFile(new URL('../drizzle/0003_account_lifecycle.sql',import.meta.url),'utf8');
      const evidence=await readFile(new URL('../drizzle/0004_holding_evidence.sql',import.meta.url),'utf8');
      const wallets=await readFile(new URL('../drizzle/0005_wallets.sql',import.meta.url),'utf8');
      const testnet=await readFile(new URL('../drizzle/0006_testnet.sql',import.meta.url),'utf8');
      const migrations=['SELECT pg_advisory_xact_lock(71540320261110)','CREATE TABLE IF NOT EXISTS currenc_connect_workspaces (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)',...(schema+';'+governance+';'+accounts+';'+evidence+';'+wallets+';'+testnet).split(';').map(s=>s.trim()).filter(Boolean)];
      await sql.transaction(migrations.map(s=>sql.query(s,[])));
      return createNeonDatabase((statement,values=[])=>sql.query(statement,values),statements=>sql.transaction(statements.map(({sql:statement,values=[]})=>sql.query(statement,values))));
    })();
    databases.set(connectionString, ready);
    ready.catch(()=>databases.delete(connectionString));
  }
  return databases.get(connectionString);
}
