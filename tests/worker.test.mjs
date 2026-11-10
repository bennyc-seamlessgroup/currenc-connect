import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
function env(){const db=new DatabaseSync(':memory:');db.exec(readFileSync('drizzle/0000_workspace.sql','utf8'));return {DB:{prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values);},async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};}}};}
const request=(user,body,origin='https://demo.test')=>new Request('https://demo.test/api/workspace',{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),Origin:origin},...(body?{body:JSON.stringify(body)}:{})});
test('API authentication, workspace isolation and persistent state',async()=>{
 const e=env();assert.equal((await worker.fetch(request(null),e)).status,401);
 let r=await worker.fetch(request('user-a',{type:'kyc',name:'Alice Demo',email:'alice@example.com',country:'Hong Kong',consent:true}),e);assert.equal(r.status,200);
 assert.equal((await r.json()).state.profile.name,'Alice Demo');
 r=await worker.fetch(request('user-a'),e);assert.equal((await r.json()).state.profile.kyc,true);
 r=await worker.fetch(request('user-b'),e);assert.equal((await r.json()).state.profile.kyc,false);
 assert.equal((await worker.fetch(request('user-a',{type:'reset'},'https://evil.test'),e)).status,403);
 assert.equal((await worker.fetch(request('user-a',{type:'not-valid'}),e)).status,422);
});
test('concurrent claims settle once using optimistic locking',async()=>{
 const e=env();const command=async body=>{const r=await worker.fetch(request('owner',body),e);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return r.json();};
 await command({type:'kyc',name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:true});
 await command({type:'verify',campaignId:'curr-welcome',shares:5000,source:'broker'});
 await command({type:'wallet',campaignId:'curr-welcome',chain:'ETH',wallet:'0x4444444444444444444444444444444444444444'});
 await command({type:'review',holderId:'sample-iris',approved:true});
 await command({type:'snapshot',campaignId:'curr-welcome'});
 const responses=await Promise.all([worker.fetch(request('owner',{type:'claim',campaignId:'curr-welcome'}),e),worker.fetch(request('owner',{type:'claim',campaignId:'curr-welcome'}),e)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,422]);
 const saved=await (await worker.fetch(request('owner'),e)).json();assert.equal(saved.state.transactions.length,1);assert.equal(saved.state.treasury.curr.ETH,24500);
});
