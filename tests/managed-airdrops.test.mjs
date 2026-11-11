import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform} from '../server/platform.mjs';
import {createManagedAirdrops,createManagedAirdropHandler} from '../server/managed-airdrops.mjs';
import {createVercelManagedAirdropHandler} from '../server/vercel-managed-airdrops.mjs';
import {parseRecipientCsv,tokenUnits,formatUnits,manifestHash} from '../server/airdrop-files.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
import {accountWorkspaceId} from '../server/vercel-workspace.mjs';
const actor=id=>({accountId:id,issuer:'test',user:{id,email:id+'@example.test',name:id,emailVerified:true}});
const addresses=['0x1111111111111111111111111111111111111111','0x2222222222222222222222222222222222222222'];
const csv='wallet_address,amount,reference\r\n'+addresses[0]+',100.000001,"First, wallet"\r\n'+addresses[1]+',0.000001,Second';
const info={name:'Wallet rewards',purpose:'Company loyalty reward',network:'ethereum',tokenAddress:'0x3333333333333333333333333333333333333333',symbol:'TEST',decimals:6,scheduledAt:'2030-01-15T12:00Z'};
async function fixture(t){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=actor('staff-private'),admin=actor('company-admin'),viewer=actor('company-viewer'),other=actor('other-company'),outsider=actor('outsider');
 const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);for(const a of [admin,viewer,other,outsider])await platform.read(a);
 const org=(await platform.execute(root,{type:'platform-create-company',name:'Managed company',ticker:'TST',token:'TEST'})).organizationId;
 const second=(await platform.execute(root,{type:'platform-create-company',name:'Other company',ticker:'OTH',token:'OTHER'})).organizationId;
 for(const [id,who,role]of [[org,admin,'admin'],[org,viewer,'viewer'],[second,other,'admin']])await platform.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:who.user.email,role});
 const service=createManagedAirdrops(DB,platform,{now:()=>new Date('2029-01-01T00:00Z')});
 return {DB,platform,service,root,admin,viewer,other,outsider,org,second,async draft(){return service.create(admin,{organizationId:org,...info});},async imported(){const d=await this.draft();return service.mutate(admin,{action:'import',id:d.campaign.id,revision:0,csv});}};
}
test('CSV: parses BOM, quotes and exact base units without rounding financial amounts',()=>{
 const parsed=parseRecipientCsv('\uFEFF'+csv,'ethereum',6);assert.equal(parsed.total,'100.000002');assert.equal(parsed.recipients[0].reference,'First, wallet');assert.equal(parsed.totalUnits,'100000002');
 const uniform=parseRecipientCsv('wallet_address,reference\n'+addresses[0]+',First\n'+addresses[1]+',Second','ethereum',6,'12.5');assert.equal(uniform.total,'25');assert.equal(uniform.recipients[1].amount,'12.5');
 assert.equal(tokenUnits('9007199254740993.000000000000000001',18).toString(),'9007199254740993000000000000000001');assert.equal(formatUnits('100000000',6),'100');
 const sol=parseRecipientCsv('wallet_address,amount\nSo11111111111111111111111111111111111111112,1.000000001','solana',9);assert.equal(sol.totalUnits,'1000000001');
});
test('CSV: rejects duplicates, invalid addresses, precision loss, malformed rows and oversized lists',()=>{
 for(const bad of ['wallet_address,amount\n'+addresses[0]+',1\n'+addresses[0]+',2','wallet_address,amount\n0x0,1','wallet_address,amount\n'+addresses[0]+',1e8','wallet_address,amount\n'+addresses[0]+',0','wallet_address,amount\n'+addresses[0]+',-1','wallet_address,amount\n'+addresses[0]+',0.0000001','wallet_address,amount,reference\n'+addresses[0]+',1,"unclosed','wallet_address,amount\n'+addresses[0]+',"1"oops','address,amount\n'+addresses[0]+',1','wallet_address,amount\n'+addresses[0]+',1,extra'])assert.throws(()=>parseRecipientCsv(bad,'ethereum',6));
 assert.throws(()=>parseRecipientCsv('x'.repeat(1024*1024+1),'ethereum',6),e=>e.status===413);
 assert.throws(()=>parseRecipientCsv('wallet_address,amount\n'+(addresses[0]+',1\n').repeat(5001),'ethereum',6),/5,000/);
 assert.throws(()=>parseRecipientCsv('wallet_address,amount\n11111111111111111111111111111111,1','solana',9),/non-zero/);
});
test('managed airdrop: company upload, locked manifest, staff review, retained versions and no simulated payouts',async t=>{
 const h=await fixture(t),d=await h.imported(),id=d.campaign.id;assert.equal(d.campaign.total,'100.000002');assert.equal((await h.platform.read(h.admin,{view:'shareholder'})).state.profile.kyc,false);
 assert.equal((await h.DB.query('SELECT * FROM cc_verified_wallets')).length,0);
 let s=await h.service.mutate(h.admin,{id,revision:1,action:'submit',confirm:true});assert.equal(s.campaign.status,'submitted');assert.match(s.campaign.manifestHash,/^[a-f0-9]{64}$/);
 const first=(await h.DB.query('SELECT * FROM cc_airdrop_versions WHERE airdrop_id=$1',[id]))[0];assert.equal(manifestHash(JSON.parse(first.manifest)),s.campaign.manifestHash);
 await assert.rejects(h.service.mutate(h.admin,{id,revision:2,action:'import',csv}),/locked/);
 s=await h.service.mutate(h.root,{id,revision:2,action:'changes',note:'Confirm the recipient amounts.'});assert.equal(s.campaign.status,'changes_requested');
 s=await h.service.mutate(h.admin,{id,revision:3,action:'import',csv:csv.replace('100.000001','200.000001')});
 s=await h.service.mutate(h.admin,{id,revision:4,action:'submit',confirm:true});assert.equal(s.campaign.version,2);assert.notEqual(s.campaign.manifestHash,first.manifest_hash);
 s=await h.service.mutate(h.root,{id,revision:5,action:'approve',note:'Distribution instructions checked.'});assert.equal(s.campaign.status,'approved');assert.equal(s.execution.connected,false);
 const versions=await h.DB.query('SELECT * FROM cc_airdrop_versions WHERE airdrop_id=$1 ORDER BY version',[id]);assert.equal(versions.length,2);assert.equal(versions[0].manifest,first.manifest);
 const state=(await h.platform.read(h.admin,{view:'company',organizationId:h.org})).state;assert.equal(state.holders.length,0);assert.equal(state.transactions.length,0);assert.deepEqual(state.treasury[h.org],{ETH:0,SOL:0,BNB:0});
 await assert.rejects(h.service.mutate(h.root,{id,revision:6,action:'release'}),/Unsupported/);
 assert.equal(s.events.find(e=>e.action==='Distribution plan approved').actor,'Platform team');assert.doesNotMatch(JSON.stringify(s),/staff-private/);
});
test('managed airdrop: scopes company data, roles, plans and public discovery',async t=>{
 const h=await fixture(t),d=await h.imported(),id=d.campaign.id;
 for(const who of [h.other,h.outsider])await assert.rejects(h.service.detail(who,{id}),e=>e.status===403);
 await assert.rejects(h.service.detail(h.admin,{id,view:'platform'}),e=>e.status===403);
 await assert.rejects(h.service.create(h.viewer,{organizationId:h.org,...info}),e=>e.status===403);
 await assert.rejects(h.service.mutate(h.viewer,{id,revision:1,action:'import',csv}),e=>e.status===403);
 await assert.rejects(h.service.mutate(h.admin,{id,revision:1,action:'approve',note:'Unauthorized'}),e=>e.status===403);
 assert.equal((await h.service.detail(h.viewer,{id})).recipients.length,2);
 const overview=await h.platform.read(h.admin,{view:'company',organizationId:h.org});assert.equal(overview.managed.campaigns.length,1);assert.equal(overview.managed.campaigns[0].recipientCount,2);assert.equal('recipients' in overview.managed.campaigns[0],false);
 assert.equal((await h.platform.read(h.other,{view:'company',organizationId:h.second})).managed.campaigns.length,0);assert.equal((await h.platform.read(h.outsider,{view:'shareholder'})).managed,null);assert.deepEqual(await readPublicCampaigns(h.DB),{campaigns:[]});
});
test('managed airdrop: stale changes, disabled accounts and suspended companies cannot mutate',async t=>{
 const h=await fixture(t),d=await h.imported(),id=d.campaign.id;
 const results=await Promise.allSettled([h.service.mutate(h.admin,{id,revision:1,action:'submit',confirm:true}),h.service.mutate(h.admin,{id,revision:1,action:'clear'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.DB.query('SELECT revision FROM cc_managed_airdrops WHERE id=$1',[id]))[0].revision,2);
 await h.DB.query("UPDATE cc_company_status SET status='suspended' WHERE organization_id=$1",[h.org]);await assert.rejects(h.service.mutate(h.admin,{id,revision:2,action:'cancel'}),e=>e.status===403);
 await h.DB.query("UPDATE cc_company_status SET status='approved' WHERE organization_id=$1",[h.org]);await h.DB.query("INSERT INTO cc_account_controls (account_id,status,archived,updated_at) VALUES ($1,'active',1,$2)",[h.admin.accountId,new Date().toISOString()]);await assert.rejects(h.service.detail(h.admin,{id}),e=>e.code==='ACCOUNT_REMOVED');
});
test('managed airdrop: token changes require clearing wallets; future time, consent and precise manifest required',async t=>{
 const h=await fixture(t),d=await h.imported(),id=d.campaign.id;
 await assert.rejects(h.service.mutate(h.admin,{action:'update',id,revision:1,...info,network:'bnb'}),/Clear/);
 await assert.rejects(h.service.mutate(h.admin,{action:'submit',id,revision:1}),/Confirm/);
 let s=await h.service.mutate(h.admin,{action:'update',id,revision:1,...info,scheduledAt:'2028-01-15T12:00Z'});await assert.rejects(h.service.mutate(h.admin,{action:'submit',id,revision:s.campaign.revision,confirm:true}),/future/);
 s=await h.service.mutate(h.admin,{action:'clear',id,revision:2});s=await h.service.mutate(h.admin,{action:'update',id,revision:3,...info,network:'bnb'});assert.equal(s.campaign.network,'bnb');assert.equal(s.recipients.length,0);
 await assert.rejects(h.service.create(h.admin,{organizationId:h.org,...info,scheduledAt:'2030-02-31T12:00Z'}),/valid UTC/);
});
test('managed airdrop: transactional audit failure rolls back the list and optimistic revision',async t=>{
 const h=await fixture(t),d=await h.draft(),id=d.campaign.id;
 h.DB.db.exec("CREATE TRIGGER reject_airdrop_audit BEFORE INSERT ON cc_airdrop_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 await assert.rejects(h.service.mutate(h.admin,{action:'import',id,revision:0,csv}),/audit unavailable/);
 const s=await h.service.detail(h.admin,{id});assert.equal(s.campaign.revision,0);assert.equal(s.recipients.length,0);
});
test('custody: public configuration is staff-only, company-scoped and never produces a credited balance',async t=>{
 const h=await fixture(t),input={label:'Master ETH',network:'ethereum',provider:'safe',address:addresses[0]};
 await assert.rejects(h.service.walletSave(h.admin,input),e=>e.status===403);await h.service.walletSave(h.root,input);
 const wallet=(await h.platform.read(h.root,{view:'platform'})).managed.wallets[0];await h.service.assetSave(h.root,{organizationId:h.org,walletId:wallet.id,tokenAddress:info.tokenAddress,symbol:'TEST',decimals:6});
 const first=(await h.platform.read(h.admin,{view:'company',organizationId:h.org})).managed;assert.equal(first.wallets.length,1);assert.equal(first.assets[0].balance,null);assert.equal(first.execution.connected,false);
 const second=(await h.platform.read(h.other,{view:'company',organizationId:h.second})).managed;assert.equal(second.wallets.length,0);assert.equal(second.assets.length,0);
 await assert.rejects(h.service.walletSave(h.root,{...input,address:'a private key is not a public address'}),/EVM address/);
});
test('company privacy: internal staff omitted from team, audit, activity and invitation projection',async t=>{
 const h=await fixture(t);await h.platform.execute(h.root,{type:'invite-member',organizationId:h.org,email:'future-member@example.test',role:'viewer'});
 const invitation=(await h.DB.query("SELECT * FROM cc_invitations WHERE email='future-member@example.test'"))[0],member=actor('future-member');const invited=await h.platform.read(member,{view:'shareholder'});assert.equal(invited.access.invitations[0].inviter,'Platform team');
 const row=(await h.DB.query('SELECT data FROM cc_organizations WHERE id=$1',[h.org]))[0],state=JSON.parse(row.data);state.activity.push({id:'private-event',at:new Date().toISOString(),actor:h.root.user.email,title:'Updated',detail:h.root.user.email+' · '+h.root.accountId,kind:'info'});await h.DB.query('UPDATE cc_organizations SET data=$1 WHERE id=$2',[JSON.stringify(state),h.org]);
 const company=await h.platform.read(h.admin,{view:'company',organizationId:h.org});assert.ok(company.team.members.some(m=>m.id===h.admin.accountId));assert.ok(!company.team.members.some(m=>m.id===h.root.accountId));assert.doesNotMatch(JSON.stringify(company.team)+JSON.stringify(company.state.activity),/staff-private/);
 const internal=await h.platform.read(h.root,{view:'platform',organizationId:h.org});assert.ok(internal.platform.company.members.some(m=>m.id===h.root.accountId));assert.ok(internal.platform.audit.some(a=>a.actor===h.root.user.email));assert.equal((await h.DB.query('SELECT role FROM cc_memberships WHERE account_id=$1 AND organization_id=$2',[h.root.accountId,h.org]))[0].role,'owner');assert.ok(invitation);
});
test('managed endpoint: authentication, verified email, same-origin, body limit and no-store',async t=>{
 const h=await fixture(t),auth=user=>async()=>({user,issuer:'test',headers:new Headers()}),environment=()=>({DATABASE_URL:'test'}),request=()=>new Request('https://portal.test/api/managed-airdrops',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json'},body:'{}'});
 for(const [user,status]of [[null,401],[{id:'x',emailVerified:false},403]]){const response=await createVercelManagedAirdropHandler({authenticate:auth(user),environment,database:async()=>h.DB})(request());assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'no-store');}
 const handler=createManagedAirdropHandler({identity:async()=>h.admin,database:async()=>h.DB});await assert.rejects(handler(new Request('https://portal.test/api/managed-airdrops',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'})),e=>e.status===403);
 await assert.rejects(handler(new Request('https://portal.test/api/managed-airdrops',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json'},body:'x'.repeat(1200*1024+1)})),e=>e.status===413);
 const d=await h.draft(),response=await handler(new Request('https://portal.test/api/managed-airdrops?id='+d.campaign.id));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('managed endpoint: authenticated Vercel adapter persists a company draft and propagates refreshed cookies',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=actor('vercel-root');root.accountId=accountWorkspaceId('test',root.user.id);const options={bootstrapOwner:{email:root.user.email,issuer:'test'}},platform=createPlatform(DB,options);await platform.read(root);
 const selection=await platform.execute(root,{type:'platform-create-company',name:'API company',ticker:'API',token:'TEST'});
 const handler=createVercelManagedAirdropHandler({authenticate:async()=>({user:root.user,issuer:'test',headers:new Headers({'Set-Cookie':'refreshed=1; HttpOnly; Secure'})}),environment:()=>({DATABASE_URL:'isolated-test'}),database:async()=>DB});
 const response=await handler(new Request('https://portal.test/api/managed-airdrops',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json'},body:JSON.stringify({action:'create',organizationId:selection.organizationId,...info,scheduledAt:'2035-01-01T12:00Z'})}));assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/refreshed=1/);const result=await response.json();assert.equal(result.campaign.status,'draft');assert.equal((await DB.query('SELECT * FROM cc_managed_airdrops')).length,1);
});

test('managed airdrop: operators prepare but cannot submit, and recipients paginate without creating accounts',async t=>{
 const h=await fixture(t),operator=actor('operator');await h.platform.read(operator);await h.platform.execute(h.root,{type:'platform-company-admin',organizationId:h.org,memberEmail:operator.user.email,role:'operator'});
 const d=await h.service.create(operator,{organizationId:h.org,...info}),id=d.campaign.id,csv='wallet_address\n'+Array.from({length:101},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0')).join('\n');
 const imported=await h.service.mutate(operator,{action:'import',id,revision:0,csv,defaultAmount:'12.5'});assert.equal(imported.campaign.total,'1262.5');assert.equal(imported.recipients.length,100);assert.equal(imported.pagination.more,true);
 const last=await h.service.detail(h.admin,{id,page:2});assert.equal(last.recipients.length,1);assert.equal(last.pagination.more,false);
 await assert.rejects(h.service.mutate(operator,{action:'submit',id,revision:1,confirm:true}),e=>e.status===403);await assert.rejects(h.service.mutate(operator,{action:'archive',id,revision:1}),e=>e.status===403);
 assert.equal((await h.DB.query('SELECT COUNT(*) AS count FROM cc_accounts'))[0].count,6);
});

test('company privacy: revoked internal staff identities stay hidden while company membership remains',async t=>{
 const h=await fixture(t),staff=actor('former-internal');await h.platform.read(staff);await h.platform.execute(h.root,{type:'platform-company-admin',organizationId:h.org,memberEmail:staff.user.email,role:'operator'});
 await h.platform.execute(h.root,{type:'platform-admin-access',accountId:staff.accountId,grant:true});await h.platform.execute(h.root,{type:'platform-admin-access',accountId:staff.accountId,grant:false});
 const team=(await h.platform.read(h.admin,{view:'company',organizationId:h.org})).team;assert.doesNotMatch(JSON.stringify(team),/former-internal/);assert.equal((await h.DB.query('SELECT role FROM cc_memberships WHERE account_id=$1 AND organization_id=$2',[staff.accountId,h.org]))[0].role,'operator');assert.equal((await h.platform.read(staff,{view:'shareholder'})).access.platformRole,null);
});
