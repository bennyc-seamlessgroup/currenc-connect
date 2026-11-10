import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import entry from '../api/workspace.js';
import authEntry from '../api/auth.js';
import {seedState} from '../lib/domain.ts';
import {accountWorkspaceId,legacyWorkspaceId,createVercelWorkspaceHandler} from '../server/vercel-workspace.mjs';
import {createNeonDatabase} from '../server/neon-database.mjs';

const origin = 'https://demo.vercel.app';
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0000_workspace.sql','utf8'));
  return {async adoptWorkspace(legacyId,accountId){return db.prepare('UPDATE demo_workspaces SET id = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM demo_workspaces WHERE id = ?)').run(accountId,legacyId,accountId).changes===1;},prepare(sql){let values=[];return {
    bind(...args){values=args;return this;},
    async first(){return db.prepare(sql).get(...values)||null;},
    async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
  };}};
}
const issuer='https://auth.example.test/db/auth';
const userA={id:'user-a',name:'Investor A',email:'a@example.com',emailVerified:true};
const userB={id:'user-b',name:'Investor B',email:'b@example.com',emailVerified:true};
const cookieA='__Secure-neon-auth.session_token=device-a';
const cookieA2='__Secure-neon-auth.session_token=device-a2';
const cookieB='__Secure-neon-auth.session_token=device-b';
function harness() {
  const DB=database();
  const sessions=new Map([[cookieA,userA],[cookieA2,userA],[cookieB,userB]]);
  const options={database:async()=>DB,environment:()=>({DATABASE_URL:'test-only'}),authenticate:async request=>({user:sessions.get((request.headers.get('Cookie')||'').split(';')[0])||null,issuer,headers:new Headers()})};
  return {handle:createVercelWorkspaceHandler(options),options,DB,sessions};
}
function request(cookie,command,headers={}) {
  return new Request(origin+'/api/workspace',{
    method:command?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers},
    ...(command?{body:JSON.stringify(command)}:{}),
  });
}


test('Vercel build serves browser assets only and exports a native API function',async()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  assert.equal(config.outputDirectory,'dist/client');
  assert.equal(config.framework,null);
  assert.equal(config.buildCommand,'npm run build');
  assert.equal(JSON.parse(readFileSync('package.json','utf8')).engines.node,'22.x');
  assert.equal(typeof entry.fetch,'function');assert.equal(typeof authEntry.fetch,'function');
  const files=readdirSync(config.outputDirectory).sort();
  assert.deepEqual(files,['app.js','favicon.svg','index.html','styles.css']);
  for(const [path,file]of [['/','index.html'],['/app.js','app.js'],['/styles.css','styles.css']]) {
    const response=await worker.fetch(new Request(origin+path),{});
    assert.equal(await response.text(),readFileSync(`${config.outputDirectory}/${file}`,'utf8'));
  }
});

test('Vercel requires verified account login and ignores browser capability and user headers',async()=>{
  const {handle,sessions}=harness();
  const anonymous=await handle(request(null,null,{'oai-authenticated-user-id':'user-a'}));
  assert.equal(anonymous.status,401);
  assert.equal(anonymous.headers.get('Set-Cookie'),null);
  assert.equal((await anonymous.json()).signIn,true);
  assert.equal((await handle(request('__Host-cc-session='+'a'.repeat(43)))).status,401);
  sessions.set('unverified',{...userA,emailVerified:false});
  assert.equal((await handle(request('unverified'))).status,403);
});

test('two devices for the same account see one workspace; a different account stays isolated',async()=>{
  const {handle,options}=harness();
  const response=await handle(request(cookieA,{type:'kyc',name:'Shared Investor',email:'demo@example.com',country:'Hong Kong',consent:true}));
  assert.equal(response.status,200);
  const fromOtherDevice=await createVercelWorkspaceHandler(options)(request(cookieA2));
  const data=await fromOtherDevice.json();
  assert.equal(data.state.profile.name,'Shared Investor');
  assert.equal(data.user.email,'a@example.com');
  assert.equal(data.runtime.identity,'Account workspace');
  const other=await handle(request(cookieB,null,{'oai-authenticated-user-id':'user-a'}));
  assert.equal((await other.json()).state.profile.kyc,false);
});

test('first account login atomically adopts the owned browser workspace and preserves revision',async()=>{
  const {handle,DB}=harness();
  const legacyCookie='__Host-cc-session='+'a'.repeat(43);
  const oldId=legacyWorkspaceId(legacyCookie);
  const state=seedState();state.profile.name='Existing browser data';
  await DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(oldId,JSON.stringify(state)).run();
  await DB.prepare('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),oldId,0).run();
  const identityOptions={database:async()=>DB,environment:()=>({DATABASE_URL:'test'}),authenticate:async()=>({user:userA,issuer,headers:new Headers()})};
  const response=await createVercelWorkspaceHandler(identityOptions)(request(cookieA+'; '+legacyCookie));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.state.profile.name,'Existing browser data');
  assert.equal(data.revision,1);
  assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal(await DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(oldId).first(),null);
  assert.ok(await DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(accountWorkspaceId(issuer,userA.id)).first());
  assert.equal(await DB.adoptWorkspace(oldId,accountWorkspaceId(issuer,userB.id)),false);
});

test('existing account data is never overwritten by a different browser demo',async()=>{
  const {handle,DB}=harness();
  await handle(request(cookieA,{type:'kyc',name:'Account data',email:'demo@example.com',country:'Hong Kong',consent:true}));
  const legacyCookie='__Host-cc-session='+'b'.repeat(43),oldId=legacyWorkspaceId(legacyCookie);
  const state=seedState();state.profile.name='Other browser demo';
  await DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(oldId,JSON.stringify(state)).run();
  const bound=createVercelWorkspaceHandler({database:async()=>DB,environment:()=>({DATABASE_URL:'test'}),authenticate:async()=>({user:userA,issuer,headers:new Headers()})});
  const data=await (await bound(request(cookieA+'; '+legacyCookie))).json();
  assert.equal(data.state.profile.name,'Account data');
  assert.equal(JSON.parse((await DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(oldId).first()).data).profile.name,'Other browser demo');
});

test('authenticated concurrent claims across devices settle exactly once',async()=>{
  const {handle,options}=harness();
  const command=async cmd=>{const response=await handle(request(cookieA,cmd));assert.equal(response.status,200);return response.json();};
  await command({type:'kyc',name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:true});
  await command({type:'verify',campaignId:'curr-welcome',shares:5000,source:'broker'});
  await command({type:'wallet',campaignId:'curr-welcome',chain:'ETH',wallet:'0x4444444444444444444444444444444444444444'});
  await command({type:'review',holderId:'sample-iris',approved:true});
  await command({type:'snapshot',campaignId:'curr-welcome'});
  const responses=await Promise.all([cookieA,cookieA2].map(cookie=>handle(request(cookie,{type:'claim',campaignId:'curr-welcome'}))));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,422]);
  const data=await (await createVercelWorkspaceHandler(options)(request(cookieA2))).json();
  assert.equal(data.state.transactions.length,1);
  assert.equal(data.state.treasury.curr.ETH,24500);
});

test('revoked sessions and cross-origin writes are rejected before database access',async()=>{
  let calls=0;
  const {handle,sessions,options}=harness();
  await handle(request(cookieA));sessions.delete(cookieA);
  const guarded=createVercelWorkspaceHandler({...options,database:async()=>{calls++;return database();}});
  assert.equal((await guarded(request(cookieA))).status,401);
  assert.equal((await guarded(request(cookieA2,{type:'reset'},{Origin:'https://other.test'}))).status,403);
  assert.equal(calls,0);
});

test('Vercel reports missing database configuration for a signed-in user',async()=>{
  const handle=createVercelWorkspaceHandler({environment:()=>({}),authenticate:async()=>({user:userA,issuer,headers:new Headers()})});
  const response=await handle(request(cookieA));
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'DATABASE_NOT_CONFIGURED');
});

test('Neon adapter parameterizes data and uses revision-conditional updates',async()=>{
  const calls=[];
  const DB=createNeonDatabase(async(sql,values)=>{calls.push({sql,values});return sql.startsWith('SELECT')?[{data:'{}',revision:7}]:[{revision:8}];});
  const record=await DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind('session-id').first();
  assert.equal(record.revision,7);
  const result=await DB.prepare('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind('{"test":true}','session-id',7).run();
  assert.equal(result.meta.changes,1);
  assert.match(calls[1].sql,/WHERE id = \$2 AND revision = \$3 RETURNING revision/);
  assert.deepEqual(calls[1].values,['{"test":true}','session-id',7]);
  assert.throws(()=>DB.prepare('DELETE FROM other_project'),/Unsupported/);
  const conflict=createNeonDatabase(async()=>[]);
  assert.equal((await conflict.prepare('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind('{}','id',7).run()).meta.changes,0);
});
