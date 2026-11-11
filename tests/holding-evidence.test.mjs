import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {createHoldingEvidence,createHoldingEvidenceHandler,MAX_HOLDING_EVIDENCE_BYTES} from '../server/holding-evidence.mjs';
import {createVercelHoldingEvidenceHandler,accountWorkspaceId} from '../server/vercel-workspace.mjs';
import {createNeonDatabase} from '../server/neon-database.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
const issuer='https://auth.example.test/auth';
const person=id=>({accountId:accountWorkspaceId(issuer,id),issuer,user:{id,name:id,email:id+'@example.test',emailVerified:true}});
const root=person('root'),investor=person('investor'),other=person('other'),viewer=person('viewer'),operator=person('operator');
const pdf=Buffer.from('%PDF-1.4\nSynthetic holding proof. No personal data.\n%%EOF');
const today=new Date().toISOString().slice(0,10),end=new Date(Date.now()+86400000*30).toISOString().slice(0,10);
const rejects=(p,status)=>assert.rejects(p,e=>e instanceof PlatformError&&e.status===status);
async function setup(t){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const options={bootstrapOwner:{email:root.user.email,issuer}},platform=createPlatform(DB,options);await platform.read(root);
 const {organizationId}=await platform.execute(root,{type:'platform-create-company',name:'Evidence QA',ticker:'EVD',token:'TEST'});
 const company=await platform.governance.application(root,organizationId);await platform.execute(root,{type:'platform-review-company',organizationId,revision:company.revision,action:'show',note:'Synthetic test only.'});
 await platform.execute(root,{type:'create',organizationId,input:{company:organizationId,name:'Evidence rewards',description:'Synthetic workflow only.',mode:'ratio',ratio:0.1,budget:10000,minimum:100,cap:1000,release:100,snapshotDate:today,deadline:end,distribution:'claim',chains:['ETH','SOL','BNB']}});
 const c=(await platform.read(root,{view:'company',organizationId})).state.campaigns[0];await platform.execute(root,{type:'open',organizationId,campaignId:c.id});
 for(const p of [investor,other,viewer,operator])await platform.execute(p,{type:'kyc',name:p.user.name,email:p.user.email,country:'Hong Kong',consent:true});
 for(const [p,role] of [[viewer,'viewer'],[operator,'operator']])await DB.query('INSERT INTO cc_memberships (organization_id,account_id,role,created_at) VALUES ($1,$2,$3,$4)',[organizationId,p.accountId,role,new Date().toISOString()]);
 const evidence=createHoldingEvidence(DB,platform),input={organizationId,campaignId:c.id,version:0,shares:1000,asOf:today,filename:'holdings.pdf',mime:'application/pdf',bytes:pdf};
 const review=(result,extras={})=>({organizationId,holderId:result.holderId,evidenceId:result.id,decision:'approved',reason:'Reviewed synthetic holder name, shares and record date.',shares:1000,asOf:today,confirmed:true,...extras});
 return {DB,platform,evidence,input,review,organizationId,c,options};
}
test('private holding proof: submit, request information, immutable resubmission, approve and lock',async t=>{
 const h=await setup(t),first=await h.evidence.upload(investor,h.input);
 let data=await h.evidence.history(root,h.organizationId,first.holderId);assert.equal(data.status,'pending');assert.equal(data.versions.length,1);assert.deepEqual((await h.evidence.download(investor,first.id)).bytes,pdf);
 await rejects(h.platform.execute(root,{type:'review',organizationId:h.organizationId,holderId:first.holderId,approved:true}),422);
 await h.evidence.review(operator,h.review(first,{decision:'needs_info',reason:'Please include the statement page with the record date.'}));
 await rejects(h.platform.execute(root,{type:'snapshot',organizationId:h.organizationId,campaignId:h.c.id}),422);
 const second=await h.evidence.upload(investor,{...h.input,version:1,shares:1200,filename:'updated.pdf',bytes:Buffer.from('%PDF-1.4\nUpdated synthetic proof\n%%EOF')});
 assert.equal(second.holderId,first.holderId);assert.equal(second.version,2);assert.deepEqual((await h.evidence.download(root,first.id)).bytes,pdf);
 await rejects(h.evidence.review(root,h.review(first)),409);
 await h.evidence.review(operator,h.review(second,{shares:1100}));
 data=await h.evidence.history(investor,h.organizationId,first.holderId);assert.equal(data.status,'verified');assert.equal(data.versions.length,2);assert.equal(data.versions[0].reviewed_shares,1100);assert.equal(data.versions[1].decision,'needs_info');
 await h.platform.execute(root,{type:'snapshot',organizationId:h.organizationId,campaignId:h.c.id});
 const state=(await h.platform.read(root,{view:'company',organizationId:h.organizationId})).state;assert.equal(state.holders[0].allocation,110);assert.equal(state.transactions.length,0);
 await rejects(h.evidence.upload(investor,{...h.input,version:2}),409);await rejects(h.evidence.review(root,h.review(second)),409);
 const rows=await h.DB.query('SELECT * FROM cc_team_audit WHERE organization_id=$1',[h.organizationId]);assert.equal(rows.filter(r=>r.action.startsWith('Holding evidence')).length,4);assert.ok(rows.every(r=>!r.detail.includes(pdf.toString('base64'))));
});
test('evidence privacy: only submitter or current company reviewers can read files and history',async t=>{
 const h=await setup(t),first=await h.evidence.upload(investor,h.input);
 for(const p of [other,viewer]){await rejects(h.evidence.download(p,first.id),404);await rejects(h.evidence.history(p,h.organizationId,first.holderId),404);await rejects(h.evidence.review(p,h.review(first)),404);}
 const strangerOrg=await h.platform.execute(root,{type:'platform-create-company',name:'Other QA',ticker:'OTHR',token:'OTHER'});await rejects(h.evidence.history(root,strangerOrg.organizationId,first.holderId),404);
 assert.equal((await h.evidence.history(operator,h.organizationId,first.holderId)).versions.length,1);
 await h.DB.query('DELETE FROM cc_memberships WHERE organization_id=$1 AND account_id=$2',[h.organizationId,operator.accountId]);await rejects(h.evidence.download(operator,first.id),404);
 const own=await h.evidence.upload(root,h.input).catch(e=>e);assert.ok(own instanceof PlatformError); // identity step is required even for staff
 const unrelated=await h.platform.read(other,{view:'shareholder'});assert.equal(unrelated.state.holders.length,0);
 const publicData=JSON.stringify(await readPublicCampaigns(h.DB));assert.ok(!publicData.includes(first.id));assert.ok(!publicData.includes('holdings.pdf'));
 const workspace=JSON.stringify(await h.platform.read(investor,{view:'shareholder'}));assert.ok(!workspace.includes(pdf.toString('base64')));assert.ok(!workspace.includes('holdings.pdf'));
});
test('holding evidence validates file type, size, date, shares, reason and approval attestation',async t=>{
 const h=await setup(t);
 for(const extras of [{mime:'text/html'},{bytes:Buffer.from('<html>')},{filename:'../escape.pdf'},{shares:1.5},{asOf:'2026-02-30'}])await rejects(h.evidence.upload(investor,{...h.input,...extras}),422);
 await rejects(h.evidence.upload(investor,{...h.input,bytes:Buffer.alloc(MAX_HOLDING_EVIDENCE_BYTES+1)}),413);
 const first=await h.evidence.upload(investor,h.input);
 for(const extras of [{reason:''},{confirmed:false},{asOf:'2020-01-01'},{shares:99}])await rejects(h.evidence.review(root,h.review(first,extras)),422);
 await h.evidence.review(root,h.review(first,{decision:'rejected',reason:'Statement does not show the required company.'}));
 const second=await h.evidence.upload(investor,{...h.input,version:1});assert.equal(second.version,2);
});
test('competing uploads/reviews settle once and audit failure rolls back evidence and eligibility',async t=>{
 const h=await setup(t),results=await Promise.allSettled([h.evidence.upload(investor,h.input),h.evidence.upload(investor,h.input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.DB.query('SELECT id FROM cc_holding_evidence')).length,1);
 const first=results.find(r=>r.status==='fulfilled').value;
 h.DB.db.exec("CREATE TRIGGER fail_proof_audit BEFORE INSERT ON cc_team_audit WHEN NEW.action='Holding evidence approved' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
 await assert.rejects(h.evidence.review(root,h.review(first)),/audit unavailable/);assert.equal((await h.evidence.history(root,h.organizationId,first.holderId)).status,'pending');assert.equal((await h.DB.query('SELECT id FROM cc_holding_reviews')).length,0);
 h.DB.db.exec('DROP TRIGGER fail_proof_audit');
 const reviews=await Promise.allSettled([h.evidence.review(root,h.review(first)),h.evidence.review(operator,h.review(first,{decision:'rejected'}))]);assert.equal(reviews.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.DB.query('SELECT id FROM cc_holding_reviews')).length,1);
});
test('atomic evidence writes recheck revoked company and account permissions',async t=>{
 const h=await setup(t),first=await h.evidence.upload(investor,h.input),atomic=h.DB.atomicChange;
 h.DB.atomicChange=async(...args)=>{await h.DB.query('DELETE FROM cc_memberships WHERE organization_id=$1 AND account_id=$2',[h.organizationId,operator.accountId]);return atomic(...args);};
 await rejects(h.evidence.review(operator,h.review(first)),409);assert.equal((await h.evidence.history(root,h.organizationId,first.holderId)).status,'pending');h.DB.atomicChange=atomic;
 await h.DB.query("INSERT INTO cc_account_controls (account_id,status,archived,updated_at) VALUES ($1,'suspended',0,$2)",[investor.accountId,new Date().toISOString()]);await rejects(h.evidence.download(investor,first.id),403);
});
test('HTTP evidence uses same-origin writes, authenticated attachments, bounded multipart and no-store',async t=>{
 const h=await setup(t),origin='https://app.example.test',handler=createHoldingEvidenceHandler({identity:async()=>investor,database:async()=>h.DB,platformOptions:h.options});
 const request=(extras={})=>{const f=new FormData();for(const key of ['organizationId','campaignId','version','shares','asOf'])f.append(key,String(h.input[key]));f.append('file',new File([pdf],'proof.pdf',{type:'application/pdf'}));return new Request(origin+'/api/holding-evidence',{method:'POST',headers:{Origin:origin,...extras},body:f});};
 await rejects(handler(request({Origin:'https://evil.test'})),403);const result=await handler(request()),doc=await result.json();assert.equal(result.headers.get('Cache-Control'),'no-store');
 const downloaded=await handler(new Request(origin+'/api/holding-evidence?id='+doc.id));assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);assert.equal(downloaded.headers.get('Content-Security-Policy'),"sandbox; default-src 'none'");assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
 await rejects(handler(new Request(origin+'/api/holding-evidence',{method:'POST',headers:{Origin:origin,'Content-Type':'multipart/form-data; boundary=x','Content-Length':String(4000000)},body:'x'})),413);
 const authenticated=createVercelHoldingEvidenceHandler({authenticate:async()=>({user:investor.user,issuer,headers:new Headers()}),database:async()=>h.DB,environment:()=>({DATABASE_URL:'unused'})});const cloudFile=await authenticated(new Request(origin+'/api/holding-evidence?id='+doc.id));assert.equal(cloudFile.status,200);assert.deepEqual(Buffer.from(await cloudFile.arrayBuffer()),pdf);
 let calls=0;for(const user of [null,{...investor.user,emailVerified:false}]){const cloud=createVercelHoldingEvidenceHandler({authenticate:async()=>({user,issuer,headers:new Headers()}),database:async()=>{calls++;return h.DB;},environment:()=>({DATABASE_URL:'unused'})});const r=await cloud(new Request(origin+'/api/holding-evidence?id='+doc.id));assert.equal(r.status,user?403:401);}assert.equal(calls,0);
});
test('Neon evidence effects remain a single conditional statement with correct parameters',async()=>{
 let seen;const DB=createNeonDatabase(async(sql,values)=>{seen={sql,values};return [{revision:2}];});await DB.atomicChange({sql:'UPDATE cc_organizations SET revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING revision',values:['org',1]},[{sql:'INSERT INTO cc_holding_reviews (id) SELECT $1 WHERE EXISTS (SELECT 1 FROM changed) RETURNING id',values:['review']}]);assert.match(seen.sql,/WITH changed AS/);assert.match(seen.sql,/SELECT \$3 WHERE EXISTS/);assert.deepEqual(seen.values,['org',1,'review']);
});
test('new-registration switch blocks new proof but permits requested follow-up; pauses block all changes',async t=>{
 const h=await setup(t),first=await h.evidence.upload(investor,h.input);
 await h.evidence.review(root,h.review(first,{decision:'needs_info'}));
 await h.DB.query("UPDATE cc_portal_settings SET shareholder_registrations=0 WHERE id='portal'");
 await rejects(h.evidence.upload(other,h.input),403);const second=await h.evidence.upload(investor,{...h.input,version:1});assert.equal(second.version,2);
 await h.DB.query('INSERT INTO cc_campaign_controls (organization_id,campaign_id,visible,paused,updated_at) VALUES ($1,$2,1,1,$3)',[h.organizationId,h.c.id,new Date().toISOString()]);
 await rejects(h.evidence.review(root,h.review(second)),409);assert.equal((await h.evidence.history(investor,h.organizationId,first.holderId)).status,'pending');
});
test('submission version limit and self review cannot bypass independent review',async t=>{
 const h=await setup(t);await h.DB.query("INSERT INTO cc_memberships (organization_id,account_id,role,created_at) VALUES ($1,$2,'operator',$3)",[h.organizationId,investor.accountId,new Date().toISOString()]);
 let result=await h.evidence.upload(investor,h.input);await rejects(h.evidence.review(investor,h.review(result)),403);
 for(let version=1;version<=10;version++){await h.evidence.review(root,h.review(result,{decision:'needs_info'}));if(version<10)result=await h.evidence.upload(investor,{...h.input,version});}
 await rejects(h.evidence.upload(investor,{...h.input,version:10}),409);assert.equal((await h.evidence.history(root,h.organizationId,result.holderId)).versions.length,10);
});

test('evidence migration is additive and repeatable without changing an existing workspace archive',t=>{
 const dir=mkdtempSync(join(tmpdir(),'currenc-proof-migration-')),path=join(dir,'old.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const legacy=new DatabaseSync(path);legacy.exec('CREATE TABLE demo_workspaces (id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)');legacy.prepare('INSERT INTO demo_workspaces (id,data,revision) VALUES (?,?,?)').run('preserved','{"archive":"unchanged"}',17);legacy.close();
 for(let pass=0;pass<2;pass++){const DB=createSqliteDatabase(path);assert.deepEqual({...DB.db.prepare('SELECT * FROM demo_workspaces').get()},{id:'preserved',data:'{"archive":"unchanged"}',revision:17});assert.equal(DB.db.prepare('SELECT COUNT(*) AS total FROM cc_holding_evidence').get().total,0);DB.close();}
});
