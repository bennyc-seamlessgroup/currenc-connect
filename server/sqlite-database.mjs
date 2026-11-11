// Loopback development and isolated tests only; production uses Neon Postgres.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function createSqliteDatabase(path) {
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../drizzle/0000_workspace.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../drizzle/0001_platform.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../drizzle/0002_governance.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(cc_account_controls)').all().some(c=>c.name==='archived'))db.exec('ALTER TABLE cc_account_controls ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  db.exec(readFileSync(new URL('../drizzle/0003_account_lifecycle.sql',import.meta.url),'utf8').replace('ALTER TABLE cc_account_controls ADD COLUMN IF NOT EXISTS archived INTEGER NOT NULL DEFAULT 0;',''));
  db.exec(readFileSync(new URL('../drizzle/0004_holding_evidence.sql',import.meta.url),'utf8'));
  const execute=(sql,values=[])=>{
    const args=[];
    const statement=db.prepare(sql.replace(/\$(\d+)/g,(_,index)=>{args.push(values[Number(index)-1]);return '?';}));
    return statement.all(...args);
  };
  return {db,close:()=>db.close(),query:async(sql,values=[])=>execute(sql,values),
    async atomicChange(change,effects=[]){
      db.exec('BEGIN IMMEDIATE');
      try{const rows=execute(change.sql,change.values);if(rows.length)for(const effect of effects)execute(effect.sql.replaceAll('EXISTS (SELECT 1 FROM changed)','1=1'),effect.values);db.exec('COMMIT');return rows;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    async mutateWithAudit(change,audit){
      db.exec('BEGIN IMMEDIATE');
      try{const rows=execute(change.sql,change.values);if(rows.length)execute(audit.sql,audit.values);db.exec('COMMIT');return rows;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    transaction:async statements=>{
      db.exec('BEGIN IMMEDIATE');
      try{const result=statements.map(({sql,values=[]})=>execute(sql,values));db.exec('COMMIT');return result;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    async adoptWorkspace(legacyId,accountId){return db.prepare('UPDATE demo_workspaces SET id=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM demo_workspaces WHERE id=?)').run(accountId,legacyId,accountId).changes===1;},
    prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)||null;},async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};}
  };
}
