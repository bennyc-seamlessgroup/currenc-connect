import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import entry from '../api/workspace.js';
import {createVercelWorkspaceHandler} from '../server/vercel-workspace.mjs';
import {createNeonDatabase} from '../server/neon-database.mjs';

const origin = 'https://demo.vercel.app';
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0000_workspace.sql','utf8'));
  return {prepare(sql){let values=[];return {
    bind(...args){values=args;return this;},
    async first(){return db.prepare(sql).get(...values)||null;},
    async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
  };}};
}
function harness() {
  const DB=database();
  const options={database:async()=>DB,environment:()=>({DATABASE_URL:'test-only'})};
  return {handle:createVercelWorkspaceHandler(options),options};
}
function request(cookie,command,headers={}) {
  return new Request(origin+'/api/workspace',{
    method:command?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers},
    ...(command?{body:JSON.stringify(command)}:{}),
  });
}
const session = response=>response.headers.get('Set-Cookie').split(';')[0];

test('Vercel build serves browser assets only and exports a native API function',async()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  assert.equal(config.outputDirectory,'dist/client');
  assert.equal(config.framework,null);
  assert.equal(config.buildCommand,'npm run build');
  assert.equal(JSON.parse(readFileSync('package.json','utf8')).engines.node,'22.x');
  assert.equal(typeof entry.fetch,'function');
  const files=readdirSync(config.outputDirectory).sort();
  assert.deepEqual(files,['app.js','favicon.svg','index.html','styles.css']);
  for(const [path,file]of [['/','index.html'],['/app.js','app.js'],['/styles.css','styles.css']]) {
    const response=await worker.fetch(new Request(origin+path),{});
    assert.equal(await response.text(),readFileSync(`${config.outputDirectory}/${file}`,'utf8'));
  }
});

test('Vercel creates isolated secure sessions and ignores caller-supplied user identities',async()=>{
  const {handle}=harness();
  const a=await handle(request(null,null,{'oai-authenticated-user-id':'forged'}));
  assert.equal(a.status,200);
  assert.match(a.headers.get('Set-Cookie'),/; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await a.json()).runtime.storage,'Cloud database');
  const cookie=session(a);
  const saved=await handle(request(cookie,{type:'kyc',name:'Session A',email:'a@example.com',country:'Hong Kong',consent:true}));
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).state.profile.name,'Session A');
  const b=await handle(request(null,null,{'oai-authenticated-user-id':'forged'}));
  assert.notEqual(session(b),cookie);
  assert.equal((await b.json()).state.profile.kyc,false);

});

test('Vercel preserves state across handler instances and concurrent claims settle once',async()=>{
  const {handle,options}=harness();
  const cookie=session(await handle(request()));
  const command=async cmd=>{const response=await handle(request(cookie,cmd));assert.equal(response.status,200);return response.json();};
  await command({type:'kyc',name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:true});
  await command({type:'verify',campaignId:'curr-welcome',shares:5000,source:'broker'});
  await command({type:'wallet',campaignId:'curr-welcome',chain:'ETH',wallet:'0x4444444444444444444444444444444444444444'});
  await command({type:'review',holderId:'sample-iris',approved:true});
  await command({type:'snapshot',campaignId:'curr-welcome'});
  const responses=await Promise.all([handle(request(cookie,{type:'claim',campaignId:'curr-welcome'})),handle(request(cookie,{type:'claim',campaignId:'curr-welcome'}))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,422]);
  const reload=await createVercelWorkspaceHandler(options)(request(cookie));
  const data=await reload.json();
  assert.equal(data.state.transactions.length,1);
  assert.equal(data.state.holders.find(h=>h.id==='self-curr-welcome').claimed,500);
  assert.equal(data.state.treasury.curr.ETH,24500);
});

test('Vercel rejects cross-origin writes and missing sessions before database access',async()=>{
  let calls=0;
  const handle=createVercelWorkspaceHandler({environment:()=>({DATABASE_URL:'test'}),database:async()=>{calls++;return database();}});
  assert.equal((await handle(request(null,{type:'reset'},{Origin:'https://other.test'}))).status,403);
  assert.equal((await handle(request(null,{type:'reset'}))).status,409);
  assert.equal(calls,0);
});

test('Vercel reports missing database configuration without pretending to save data',async()=>{
  const handle=createVercelWorkspaceHandler({environment:()=>({})});
  const response=await handle(request());
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'DATABASE_NOT_CONFIGURED');
  assert.equal(response.headers.get('Set-Cookie'),null);
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
