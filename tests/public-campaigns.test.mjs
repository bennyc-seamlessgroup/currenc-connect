import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform} from '../server/platform.mjs';
import {readPublicCampaigns,createPublicCampaignsHandler} from '../server/public-campaigns.mjs';
import {seedState} from '../lib/domain.ts';

const now=new Date('2026-11-10T08:00:00Z');
const actor={accountId:'staff',issuer:'test',user:{email:'staff@example.test',emailVerified:true}};
async function fixture(t){const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());await createPlatform(DB,{now:()=>now}).read(actor);return DB;}
async function company(DB,id,{status='approved',visible=1,campaigns=[{}]}={}){
 const meta={id,name:id,ticker:'ABC',initials:'A',color:'#39796f',contactEmail:'PRIVATE-CONTACT'};
 const data={...seedState(),companies:[meta],holders:[{name:'PRIVATE-HOLDER',email:'PRIVATE-EMAIL',wallet:'PRIVATE-WALLET'}],transactions:[{id:'PRIVATE-TRANSACTION'}],treasury:{secret:'PRIVATE-FUNDS'},activity:[{detail:'PRIVATE-AUDIT'}],campaigns:campaigns.map((c,i)=>({...seedState().campaigns[0],id:id+'-'+i,company:id,status:'open',name:'Rewards '+i,description:'Campaign terms',snapshotDate:'2026-11-10',deadline:'2026-12-10',internalNote:'PRIVATE-NOTE',...c}))};
 await DB.query('INSERT INTO cc_organizations (id,company,data,owner_id,created_at) VALUES ($1,$2,$3,$4,$5)',[id,JSON.stringify(meta),JSON.stringify(data),actor.accountId,now.toISOString()]);
 await DB.query('INSERT INTO cc_company_status (organization_id,status,visible,application,created_at) VALUES ($1,$2,$3,$4,$5)',[id,status,visible,JSON.stringify({legalName:'PRIVATE-APPLICATION'}),now.toISOString()]);
 return data;
}
test('anonymous discovery returns only published terms and does not create identities or expose workspace data',async t=>{
 const DB=await fixture(t);await company(DB,'Listed');
 const before=await DB.query('SELECT COUNT(*) AS count FROM cc_accounts');
 const handler=createPublicCampaignsHandler({database:async()=>DB,environment:()=>({DATABASE_URL:'test'}),now:()=>now});
 const response=await handler(new Request('https://example.test/api/public-campaigns?organization=hidden&view=platform',{headers:{'oai-authenticated-user-id':'staff'}}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);
 const data=await response.json();assert.equal(data.campaigns.length,1);assert.equal(data.campaigns[0].canRegister,true);
 assert.deepEqual(Object.keys(data),['campaigns']);assert.deepEqual(Object.keys(data.campaigns[0].company),['id','name','ticker','initials','color']);
 assert.doesNotMatch(JSON.stringify(data),/PRIVATE-|holders|treasury|transactions|owner_id|profile|revision|application|accountId/);
 assert.deepEqual(await DB.query('SELECT COUNT(*) AS count FROM cc_accounts'),before);
});
test('discovery excludes hidden, inactive and suspended companies and unpublished, archived or expired campaigns',async t=>{
 const DB=await fixture(t);
 for(const [id,status,visible]of [['Hidden','approved',0],['Inactive','draft',1],['Suspended','suspended',1]])await company(DB,id,{status,visible});
 await company(DB,'Listed',{campaigns:[{},...['draft','closed','archived','deleted'].map(status=>({status})),{deadline:'2026-11-09'},{claimDeadline:'2026-11-09'},{company:'Hidden'},{status:'locked'},{status:'paused'}]});
 await DB.query('INSERT INTO cc_campaign_controls (organization_id,campaign_id,visible,updated_at) VALUES ($1,$2,0,$3)',['Listed','Listed-0',now.toISOString()]);
 const data=await readPublicCampaigns(DB,{now});assert.deepEqual(data.campaigns.map(c=>c.status),['locked','paused']);
 assert.ok(data.campaigns.every(c=>c.company.name==='Listed'&&!c.canRegister));
});
test('discovery reflects listing and registration controls immediately and preserves separate deadlines',async t=>{
 const DB=await fixture(t);await company(DB,'Listed',{campaigns:[{registrationDeadline:'2026-11-09',claimDeadline:'2027-01-01'},{registrationDeadline:'2026-11-10',claimDeadline:'2027-01-01'}]});
 let data=await readPublicCampaigns(DB,{now});assert.equal(data.campaigns.length,2);assert.equal(data.campaigns[0].canRegister,false);assert.equal(data.campaigns[1].canRegister,true);assert.equal(data.campaigns[1].claimDeadline,'2027-01-01');
 await DB.query("UPDATE cc_portal_settings SET shareholder_registrations=0 WHERE id='portal'");data=await readPublicCampaigns(DB,{now});assert.ok(data.campaigns.every(c=>!c.canRegister));
 await DB.query('INSERT INTO cc_campaign_controls (organization_id,campaign_id,paused,updated_at) VALUES ($1,$2,1,$3)',['Listed','Listed-1',now.toISOString()]);assert.equal((await readPublicCampaigns(DB,{now})).campaigns[1].status,'paused');
 await DB.query("UPDATE cc_company_status SET visible=0 WHERE organization_id='Listed'");assert.deepEqual(await readPublicCampaigns(DB,{now}),{campaigns:[]});
});
test('public discovery rejects mutations and hides configuration and database failures',async()=>{
 let calls=0;const unavailable=createPublicCampaignsHandler({database:async()=>{calls++;throw Error('PRIVATE-SECRET');},environment:()=>({DATABASE_URL:'test'})});
 assert.equal((await unavailable(new Request('https://example.test/api/public-campaigns',{method:'POST'}))).status,405);assert.equal(calls,0);
 const response=await unavailable(new Request('https://example.test/api/public-campaigns'));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE/);
 const missing=createPublicCampaignsHandler({database:async()=>{throw Error('must not connect');},environment:()=>({})});assert.equal((await missing(new Request('https://example.test/api/public-campaigns'))).status,503);
});
