import {neon} from '@neondatabase/serverless';

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
export function createNeonDatabase(query) {
  return {prepare(statement) {
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
      await sql.query('CREATE TABLE IF NOT EXISTS currenc_connect_workspaces (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
      return createNeonDatabase((statement,values)=>sql.query(statement,values));
    })();
    databases.set(connectionString, ready);
    ready.catch(()=>databases.delete(connectionString));
  }
  return databases.get(connectionString);
}
