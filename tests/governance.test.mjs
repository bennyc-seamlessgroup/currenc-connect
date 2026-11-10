import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {createCompanyDocuments,createDocumentHandler,MAX_COMPANY_DOCUMENT_BYTES} from '../server/company-documents.mjs';
import {createVercelDocumentHandler,accountWorkspaceId} from '../server/vercel-workspace.mjs';
import {seedState} from '../lib/domain.ts';

const issuer='https://auth.example.test/auth';
const actor=id=>({accountId:'account-'+id,issuer,user:{id,name:id,email:id+'@example.com',emailVerified:true}});
const root=actor('root'),owner=actor('company-owner'),investor=actor('investor'),stranger=actor('stranger');
const application={legalName:'Test Company Limited',registrationNumber:'TEST-123',jurisdiction:'Hong Kong',website:'https://example.com',contactName:'Test Representative',contactEmail:'test@example.com',representativeRole:'Director',authorized:true};
const pdf=Buffer.from('%PDF-1.4\nTest-only evidence. No real company or identity verification.\n%%EOF');
function harness(t,{bootstrap=true}={}){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const options={bootstrapOwner:bootstrap?{email:root.user.email,issuer}:undefined};
 const platform=createPlatform(DB,options),documents=createCompanyDocuments(DB,platform);
 return {DB,options,...platform,platform,documents};
}
async function createCompany(h,person=owner){await h.read(person);return (await h.execute(person,{type:'create-organization',name:'Test Company',ticker:'TEST',token:'TST'})).organizationId;}
async function app(h,id){return h.governance.application(owner,id);}
async function save(h,id,fields=application){const current=await app(h,id);await h.execute(owner,{type:'save-company-application',organizationId:id,revision:current.revision,application:fields});}
async function evidence(h,id,purpose,bytes=pdf){const current=await app(h,id);return h.documents.upload(owner,{organizationId:id,purpose,revision:current.revision,filename:purpose+'.pdf',mime:'application/pdf',bytes});}
async function submit(h,id){const current=await app(h,id);return h.execute(owner,{type:'submit-company-application',organizationId:id,revision:current.revision,application});}
async function review(h,id,action='approve',extras={}){const current=await app(h,id);return h.execute(root,{type:'platform-review-company',organizationId:id,revision:current.revision,action,note:'Workflow test decision only.',...extras});}
async function ready(h){await h.read(root);const id=await createCompany(h);await save(h,id);await evidence(h,id,'company');await evidence(h,id,'authority');await submit(h,id);await review(h,id);return id;}
async function draftCampaign(h,id){const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+86400000*30).toISOString().slice(0,10);await h.execute(owner,{type:'create',organizationId:id,input:{company:id,name:'Test rewards',description:'Workflow sample',mode:'ratio',ratio:0.1,budget:10000,minimum:100,cap:10000,release:100,snapshotDate:today,deadline,distribution:'claim',chains:['ETH','SOL','BNB']}});return (await h.read(owner,{view:'company',organizationId:id})).state.campaigns.at(-1).id;}
async function register(h,id,cid,person=investor){await h.execute(person,{type:'kyc',name:person.user.name,email:'demo@example.com',country:'Hong Kong',consent:true});await h.execute(person,{type:'verify',organizationId:id,campaignId:cid,shares:5000,source:'broker'});await h.execute(person,{type:'wallet',organizationId:id,campaignId:cid,chain:'ETH',wallet:'0x'+'1'.repeat(40)});}
const rejects=(promise,status)=>assert.rejects(promise,e=>e instanceof PlatformError&&e.status===status);

test('platform owner bootstrap is deployment-controlled, verified, issuer-bound and permanent by account ID',async t=>{
 const h=harness(t);
 for(const person of [owner,{...root,accountId:'forged-issuer',issuer:'https://other.test'}, {...root,accountId:'unverified',user:{...root.user,emailVerified:false}}]){
  const data=await h.read(person);assert.equal(data.access.platformRole,null);await rejects(h.read(person,{view:'platform'}),403);
 }
 const data=await h.read(root);assert.equal(data.access.platformRole,'owner');
 await h.read({...root,user:{...root.user,email:'renamed@example.com'}});assert.equal(await h.governance.platformRole(root.accountId),'owner');
 const later={...root,accountId:'new-identity'};await h.read(later);assert.equal(await h.governance.platformRole(later.accountId),null);
 await rejects(h.execute(owner,{type:'platform-admin-access',accountId:owner.accountId,grant:true,role:'owner'}),403);
 const none=harness(t,{bootstrap:false});assert.equal((await none.read(root)).access.platformRole,null);
});

test('company registration saves drafts and private evidence, requests correction, then approves one immutable submission',async t=>{
 const h=harness(t);await h.read(root);const id=await createCompany(h),cid=await draftCampaign(h,id);
 assert.equal((await app(h,id)).status,'draft');assert.equal((await h.read(investor,{view:'shareholder'})).state.companies.length,0);
 await rejects(h.execute(owner,{type:'open',organizationId:id,campaignId:cid}),403);
 await save(h,id);await rejects(submit(h,id),422);await evidence(h,id,'company');await evidence(h,id,'authority');await submit(h,id);
 let current=await app(h,id);assert.equal(current.status,'pending');await rejects(save(h,id),409);await rejects(evidence(h,id,'authority'),409);
 await review(h,id,'request-info');assert.equal((await app(h,id)).status,'needs_info');
 await save(h,id,{...application,contactName:'Corrected representative'});await evidence(h,id,'authority',Buffer.from('%PDF-1.4\nUpdated test-only authority\n%%EOF'));await submit(h,id);
 const before=(await app(h,id)).revision;await review(h,id);
 current=await app(h,id);assert.equal(current.status,'approved');assert.equal(current.visible,1);assert.equal(current.revision,before+1);
 await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});assert.equal((await h.read(investor,{view:'shareholder'})).state.campaigns.length,1);
 const platformView=await h.read(root,{view:'platform',organizationId:id});assert.equal(platformView.platform.company.submissions.length,2);assert.equal(platformView.platform.company.submissions[0].documents.length,2);
 assert.doesNotMatch(JSON.stringify(platformView),/JVBER|Test-only evidence|"content"/);
 await rejects(h.read(root,{view:'company',organizationId:id}),403);
});

test('stale or competing company decisions cannot approve a replaced application or create duplicate audit decisions',async t=>{
 const h=harness(t);await h.read(root);const id=await createCompany(h);await save(h,id);await evidence(h,id,'company');await evidence(h,id,'authority');await submit(h,id);
 const stale=(await app(h,id)).revision;await review(h,id,'request-info');await save(h,id);await submit(h,id);
 await rejects(h.execute(root,{type:'platform-review-company',organizationId:id,revision:stale,action:'approve',note:'Stale decision must fail.'}),409);
 const revision=(await app(h,id)).revision;
 const results=await Promise.allSettled(['approve','reject'].map(action=>h.execute(root,{type:'platform-review-company',organizationId:id,revision,action,note:'Concurrent test decision.'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await app(h,id)).reviews.filter(r=>r.note==='Concurrent test decision.').length,1);
});

test('company and campaign moderation hide new registrations, preserve allocations, and stop suspended payouts',async t=>{
 const h=harness(t),id=await ready(h),cid=await draftCampaign(h,id);await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});await register(h,id,cid);
 await h.execute(owner,{type:'fund',organizationId:id,company:id,chain:'ETH',amount:1000});await h.execute(owner,{type:'snapshot',organizationId:id,campaignId:cid});
 await review(h,id,'hide');assert.equal((await h.read(stranger,{view:'shareholder'})).state.companies.length,0);assert.equal((await h.read(investor,{view:'shareholder'})).state.holders[0].allocation,500);
 await review(h,id,'show');
 await h.execute(root,{type:'platform-campaign-control',organizationId:id,campaignId:cid,revision:0,action:'pause',note:'Pause test payout.'});
 await rejects(h.execute(investor,{type:'claim',organizationId:id,campaignId:cid}),403);await rejects(h.execute(owner,{type:'release',organizationId:id,campaignId:cid,percent:100}),403);
 await h.execute(root,{type:'platform-campaign-control',organizationId:id,campaignId:cid,revision:1,action:'resume',note:'Resume test payout.'});
 await review(h,id,'suspend');await rejects(h.execute(investor,{type:'claim',organizationId:id,campaignId:cid}),403);await rejects(h.execute(owner,{type:'fund',organizationId:id,company:id,chain:'ETH',amount:1}),403);
 assert.equal((await h.read(investor,{view:'shareholder'})).state.holders[0].allocation,500);await review(h,id,'resume');await h.execute(investor,{type:'claim',organizationId:id,campaignId:cid});
 const view=await h.read(owner,{view:'company',organizationId:id});assert.equal(view.state.transactions.length,1);assert.equal(view.state.treasury[id].ETH,500);
});

test('portal controls pause new submissions and enrollments while retaining existing personal records',async t=>{
 const h=harness(t),id=await ready(h),cid=await draftCampaign(h,id);await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});await h.read(investor);const settings=await h.governance.settings();
 await h.execute(root,{type:'platform-settings',revision:settings.revision,companyApplications:false,shareholderRegistrations:false,announcement:'Portal test notice'});
 await rejects(createCompany(h,stranger),403);await h.execute(investor,{type:'kyc',name:'Test investor',email:'demo@example.com',country:'Hong Kong',consent:true});await rejects(h.execute(investor,{type:'verify',organizationId:id,campaignId:cid,shares:5000,source:'broker'}),403);
 const personal=await h.read(investor,{view:'shareholder'});assert.equal(personal.state.profile.name,'Test investor');assert.equal(personal.access.portal.announcement,'Portal test notice');
 await rejects(h.execute(owner,{type:'platform-settings',revision:1,companyApplications:true,shareholderRegistrations:true}),403);
});

test('restoring an unapproved company returns it to application review without granting publishing permission',async t=>{
 const h=harness(t);await h.read(root);const id=await createCompany(h);await review(h,id,'suspend');assert.equal((await app(h,id)).status,'suspended');
 await review(h,id,'resume');const restored=await app(h,id);assert.equal(restored.status,'needs_info');assert.equal(restored.visible,0);
 const cid=await draftCampaign(h,id);await rejects(h.execute(owner,{type:'open',organizationId:id,campaignId:cid}),403);
});

test('platform owner delegates admins, revokes access and manages registered company admins without changing company ownership',async t=>{
 const h=harness(t),id=await ready(h),admin=actor('platform-admin'),member=actor('company-admin');await h.read(admin);await h.read(member);
 await h.execute(root,{type:'platform-admin-access',accountId:admin.accountId,grant:true});assert.equal((await h.read(admin,{view:'platform'})).context.role,'admin');
 await rejects(h.execute(admin,{type:'platform-admin-access',accountId:member.accountId,grant:true}),403);
 await h.execute(admin,{type:'platform-company-admin',organizationId:id,memberEmail:member.user.email,role:'admin'});assert.equal((await h.read(member,{view:'company',organizationId:id})).context.role,'admin');
 await rejects(h.execute(member,{type:'platform-review-company',organizationId:id,revision:0,action:'approve',note:'Company admin is not platform admin.'}),403);
 await rejects(h.execute(admin,{type:'platform-company-admin',organizationId:id,memberId:owner.accountId,role:'viewer'}),403);
 await rejects(h.execute(root,{type:'platform-account-status',accountId:admin.accountId,status:'suspended',revision:0,note:'Protected platform admin.'}),403);
 await h.execute(root,{type:'platform-admin-access',accountId:admin.accountId,grant:false});await rejects(h.read(admin,{view:'platform'}),403);
 await h.execute(root,{type:'platform-account-status',accountId:admin.accountId,status:'suspended',revision:0,note:'Disable revoked test admin.'});
 await rejects(h.read(admin,{view:'shareholder'}),403);await h.execute(root,{type:'platform-account-status',accountId:admin.accountId,status:'active',revision:1,note:'Restore test admin account.'});assert.equal((await h.read(admin)).access.platformRole,null);
});

test('private documents require application access; versions remain immutable and file limits are enforced',async t=>{
 const h=harness(t);await h.read(root);const id=await createCompany(h),viewer=actor('viewer');await h.read(viewer);
 await h.execute(owner,{type:'invite-member',organizationId:id,email:viewer.user.email,role:'viewer'});const invitation=(await h.read(viewer)).access.invitations[0];await h.execute(viewer,{type:'accept-invitation',invitationId:invitation.id});
 const first=await evidence(h,id,'company');await evidence(h,id,'company',Buffer.from('%PDF-1.4\nSecond version\n%%EOF'));
 assert.deepEqual((await h.documents.download(owner,first.id)).bytes,pdf);assert.deepEqual((await h.documents.download(root,first.id)).bytes,pdf);
 await rejects(h.documents.download(viewer,first.id),403);await rejects(h.documents.download(stranger,first.id),403);
 const current=await app(h,id);assert.equal(current.documents.length,1);assert.notEqual(current.documents[0].id,first.id);
 await rejects(h.documents.upload(owner,{organizationId:id,purpose:'authority',revision:current.revision,filename:'fake.pdf',mime:'application/pdf',bytes:Buffer.from('<html>bad</html>')}),422);
 await rejects(h.documents.upload(owner,{organizationId:id,purpose:'authority',revision:current.revision,filename:'large.pdf',mime:'application/pdf',bytes:Buffer.alloc(MAX_COMPANY_DOCUMENT_BYTES+1)}),413);
 await rejects(h.documents.upload(owner,{organizationId:id,purpose:'authority',revision:current.revision-1,filename:'stale.pdf',mime:'application/pdf',bytes:pdf}),409);
});

test('multipart document API checks origin, bounded bodies and authenticated downloads with no public URL or inline execution',async t=>{
 const h=harness(t);const id=await createCompany(h);const handler=createDocumentHandler({identity:async()=>owner,database:async()=>h.DB});
 const origin='https://app.example.test';
 const request=async(headers={})=>{const form=new FormData();form.append('organizationId',id);form.append('purpose','authority');form.append('revision',String((await app(h,id)).revision));form.append('file',new File([pdf],'authority.pdf',{type:'application/pdf'}));return new Request(origin+'/api/company-document',{method:'POST',headers:{Origin:origin,...headers},body:form});};
 await rejects(handler(await request({Origin:'https://attacker.test'})),403);
 const uploaded=await handler(await request());assert.equal(uploaded.status,200);const document=(await uploaded.json()).document;
 const downloaded=await handler(new Request(origin+'/api/company-document?id='+document.id));assert.equal(downloaded.headers.get('Cache-Control'),'no-store');assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);assert.equal(downloaded.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
 const oversized=new Request(origin+'/api/company-document',{method:'POST',headers:{Origin:origin,'Content-Type':'multipart/form-data; boundary=test','Content-Length':String(4*1024*1024)},body:'test'});await rejects(handler(oversized),413);
});

test('hosted document API ignores forged identity headers and fails closed before database access',async()=>{
 let calls=0;const handler=createVercelDocumentHandler({database:async()=>{calls++;throw Error('must not run');},environment:()=>({DATABASE_URL:'test'}),authenticate:async()=>({user:null,issuer,headers:new Headers()})});
 const response=await handler(new Request('https://app.example.test/api/company-document?id=private', {headers:{'oai-authenticated-user-id':accountWorkspaceId(issuer,root.user.id),'x-neon-auth-user-id':root.user.id}}));assert.equal(response.status,401);assert.equal(calls,0);
});

test('existing sample companies retain data but require explicit sandbox approval instead of automatic public access',async t=>{
 const h=harness(t);const legacy=seedState();legacy.treasury.curr.ETH=25001;await h.DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(owner.accountId,JSON.stringify(legacy)).run();
 const view=await h.read(owner);const id=view.access.organizations.find(o=>o.legacyId==='curr').id;assert.equal((await h.read(investor,{view:'shareholder'})).state.companies.length,0);await h.read(root);
 await review(h,id,'approve',{approvalMode:'sandbox'});assert.equal((await app(h,id)).approval_mode,'sandbox');assert.equal((await h.read(owner,{view:'company',organizationId:id})).state.treasury[id].ETH,25001);
 const fresh=await createCompany(h);await rejects(review(h,fresh,'approve',{approvalMode:'sandbox'}),422);
});
