import test from 'node:test';
import {verifiedTestWallet} from './helpers/wallets.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
async function createCompany(h,person=owner){
 await h.read(root);await h.read(person);
 await h.DB.query("INSERT INTO cc_platform_admins (account_id,role,created_at) VALUES ($1,'admin',$2) ON CONFLICT (account_id) DO NOTHING",[person.accountId,new Date().toISOString()]);
 const selected=await h.execute(person,{type:'platform-create-company',name:'Test Company',ticker:'TEST',token:'TST'});
 if(person.accountId!==root.accountId)await h.DB.query("DELETE FROM cc_platform_admins WHERE account_id=$1 AND role='admin'",[person.accountId]);
 return selected.organizationId;
}
async function app(h,id){return h.governance.application(root,id);}
async function save(h,id,fields=application){const c=(await h.read(root,{view:'platform',organizationId:id})).platform.company;return h.execute(root,{type:'platform-save-company',organizationId:id,revision:c.revision,organizationRevision:c.organizationRevision,name:c.company.name,ticker:c.company.ticker,info:fields});}
async function evidence(h,id,purpose,bytes=pdf){const current=await app(h,id);return h.documents.upload(root,{organizationId:id,purpose,revision:current.revision,filename:purpose+'.pdf',mime:'application/pdf',bytes});}
async function review(h,id,action='activate',extras={}){const current=await app(h,id);return h.execute(root,{type:'platform-review-company',organizationId:id,revision:current.revision,action,note:'Workflow test decision only.',...extras});}
async function ready(h){const id=await createCompany(h);await save(h,id);await review(h,id,'show');return id;}
async function draftCampaign(h,id){const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+86400000*30).toISOString().slice(0,10);await h.execute(owner,{type:'create',organizationId:id,input:{company:id,name:'Test rewards',description:'Workflow sample',mode:'ratio',ratio:0.1,budget:10000,minimum:100,cap:10000,release:100,snapshotDate:today,deadline,distribution:'claim',chains:['ETH','SOL','BNB']}});return (await h.read(owner,{view:'company',organizationId:id})).state.campaigns.at(-1).id;}
async function register(h,id,cid,person=investor){await h.execute(person,{type:'kyc',name:person.user.name,email:'demo@example.com',country:'Hong Kong',consent:true});await h.execute(person,{type:'verify',organizationId:id,campaignId:cid,shares:5000,source:'broker'});const wallet=await verifiedTestWallet(h.DB,h.platform,person);await h.execute(person,{type:'wallet',organizationId:id,campaignId:cid,walletId:wallet.id,walletRevision:wallet.revision});}
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

test('only platform staff register and edit companies; user submissions are retired and files are optional',async t=>{
 const h=harness(t);await h.read(root);await h.read(owner);
 for(const type of ['create-organization','save-company-application','submit-company-application','platform-create-company','platform-save-company'])await rejects(h.execute(owner,{type,name:'Forbidden',ticker:'TEST',token:'TST'}),403);
 const id=await createCompany(h);assert.equal((await app(h,id)).status,'approved');assert.equal((await app(h,id)).visible,0);
 await rejects(h.governance.application(owner,id),403);assert.equal((await h.read(owner,{view:'company',organizationId:id})).companyApplication,null);
 const cid=await draftCampaign(h,id);await review(h,id,'deactivate');await rejects(h.execute(owner,{type:'open',organizationId:id,campaignId:cid}),403);
 await save(h,id);await review(h,id,'activate');await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});
 assert.equal((await h.read(investor,{view:'shareholder'})).state.companies.length,0);
 await review(h,id,'show');assert.equal((await h.read(investor,{view:'shareholder'})).state.campaigns.length,1);
 const before=await h.read(owner,{view:'company',organizationId:id});const c=(await h.read(root,{view:'platform',organizationId:id})).platform.company;
 await h.execute(root,{type:'platform-save-company',organizationId:id,revision:c.revision,organizationRevision:c.organizationRevision,name:'Renamed Company',ticker:'NEW',info:{...application,contactName:'Updated contact'}});
 const after=await h.read(owner,{view:'company',organizationId:id});assert.equal(after.state.companies[0].name,'Renamed Company');assert.deepEqual(after.state.campaigns,before.state.campaigns);assert.deepEqual(after.state.treasury,before.state.treasury);
 assert.equal((await app(h,id)).documents.length,0);assert.equal((await h.read(root,{view:'platform',organizationId:id})).platform.company.submissions.length,0);
 await rejects(h.read(root,{view:'company',organizationId:id}),403);
});

test('stale company edits and competing activation changes fail without duplicate status records',async t=>{
 const h=harness(t),id=await createCompany(h);await review(h,id,'deactivate');const c=(await h.read(root,{view:'platform',organizationId:id})).platform.company;
 await save(h,id);await rejects(h.execute(root,{type:'platform-save-company',organizationId:id,revision:c.revision,organizationRevision:c.organizationRevision,name:'Stale name',ticker:'OLD',info:{}}),409);
 const revision=(await app(h,id)).revision;
 const results=await Promise.allSettled(['activate','suspend'].map(action=>h.execute(root,{type:'platform-review-company',organizationId:id,revision,action,note:'Concurrent test decision.'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await app(h,id)).reviews.filter(r=>r.note==='Concurrent test decision.').length,1);
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

test('portal controls pause enrollments without blocking staff company creation while retaining existing personal records',async t=>{
 const h=harness(t),id=await ready(h),cid=await draftCampaign(h,id);await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});await h.read(investor);const settings=await h.governance.settings();
 await h.execute(root,{type:'platform-settings',revision:settings.revision,companyApplications:false,shareholderRegistrations:false,announcement:'Portal test notice'});
 await h.execute(root,{type:'platform-create-company',name:'Staff company',ticker:'NEW',token:'TEST'});await rejects(h.execute(stranger,{type:'create-organization',name:'Forbidden',ticker:'NO',token:'NO'}),403);await h.execute(investor,{type:'kyc',name:'Test investor',email:'demo@example.com',country:'Hong Kong',consent:true});await rejects(h.execute(investor,{type:'verify',organizationId:id,campaignId:cid,shares:5000,source:'broker'}),403);
 const personal=await h.read(investor,{view:'shareholder'});assert.equal(personal.state.profile.name,'Test investor');assert.equal(personal.access.portal.announcement,'Portal test notice');
 await rejects(h.execute(owner,{type:'platform-settings',revision:1,companyApplications:true,shareholderRegistrations:true}),403);
});

test('restoring an unapproved company returns it to inactive status without granting publishing permission',async t=>{
 const h=harness(t);await h.read(root);const id=await createCompany(h);await review(h,id,'deactivate');await review(h,id,'suspend');assert.equal((await app(h,id)).status,'suspended');
 await review(h,id,'resume');const restored=await app(h,id);assert.equal(restored.status,'draft');assert.equal(restored.visible,0);
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
 await rejects(h.documents.download(owner,first.id),403);assert.deepEqual((await h.documents.download(root,first.id)).bytes,pdf);
 await rejects(h.documents.download(viewer,first.id),403);await rejects(h.documents.download(stranger,first.id),403);
 const current=await app(h,id);assert.equal(current.documents.length,1);assert.notEqual(current.documents[0].id,first.id);
 await rejects(h.documents.upload(root,{organizationId:id,purpose:'authority',revision:current.revision,filename:'fake.pdf',mime:'application/pdf',bytes:Buffer.from('<html>bad</html>')}),422);
 await rejects(h.documents.upload(root,{organizationId:id,purpose:'authority',revision:current.revision,filename:'large.pdf',mime:'application/pdf',bytes:Buffer.alloc(MAX_COMPANY_DOCUMENT_BYTES+1)}),413);
 await rejects(h.documents.upload(root,{organizationId:id,purpose:'authority',revision:current.revision-1,filename:'stale.pdf',mime:'application/pdf',bytes:pdf}),409);
});

test('multipart document API checks origin, bounded bodies and authenticated downloads with no public URL or inline execution',async t=>{
 const h=harness(t);const id=await createCompany(h);const handler=createDocumentHandler({identity:async()=>root,database:async()=>h.DB});
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

test('existing sample companies retain all data and require a staff activation before public access',async t=>{
 const h=harness(t);const legacy=seedState();legacy.treasury.curr.ETH=25001;await h.DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(owner.accountId,JSON.stringify(legacy)).run();
 const view=await h.read(owner);const id=view.access.organizations.find(o=>o.legacyId==='curr').id;assert.equal((await h.read(investor,{view:'shareholder'})).state.companies.length,0);await h.read(root);
 await review(h,id,'activate');await review(h,id,'show');assert.equal((await app(h,id)).approval_mode,'managed');assert.equal((await h.read(owner,{view:'company',organizationId:id})).state.treasury[id].ETH,25001);
 const fresh=await createCompany(h);await rejects(review(h,fresh,'approve',{approvalMode:'sandbox'}),422);
});

test('platform removes company access, rejects stale roles and owners, revokes old invitation links and preserves other records',async t=>{
 const h=harness(t),id=await ready(h),member=actor('removable-admin');await h.read(member);
 await h.execute(member,{type:'kyc',name:'Personal investor',email:'personal@example.com',country:'Hong Kong',consent:true});
 await h.execute(owner,{type:'invite-member',organizationId:id,email:member.user.email,role:'viewer'});const oldInvitation=(await h.read(member)).access.invitations[0].id;
 await h.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:member.user.email,role:'admin'});
 await rejects(h.execute(member,{type:'accept-invitation',invitationId:oldInvitation}),403);
 const other=await createCompany(h);await h.execute(root,{type:'platform-company-admin',organizationId:other,memberEmail:member.user.email,role:'viewer'});
 const remove=(who,person,expectedRole)=>h.execute(who,{type:'platform-remove-company-member',organizationId:id,memberId:person.accountId,expectedRole,note:'Remove synthetic company access.'});
 await rejects(remove(member,owner,'owner'),403);await rejects(remove(root,owner,'owner'),403);await rejects(remove(root,root,'owner'),403);await rejects(remove(root,member,'viewer'),409);
 await h.execute(root,{type:'platform-company-admin',organizationId:id,memberId:member.accountId,expectedRole:'admin',role:'viewer'});await rejects(remove(root,member,'admin'),409);await remove(root,member,'viewer');
 await rejects(h.read(member,{view:'company',organizationId:id}),403);assert.equal((await h.read(member,{view:'company',organizationId:other})).context.role,'viewer');assert.equal((await h.read(member,{view:'shareholder'})).state.profile.name,'Personal investor');
 const view=(await h.read(root,{view:'platform',organizationId:id}));assert.ok(!view.platform.company.members.some(m=>m.id===member.accountId));assert.equal(view.platform.audit.filter(a=>a.action==='Company member removed').length,1);assert.ok((await h.read(owner,{view:'company',organizationId:id})).team.audit.some(a=>a.action==='Platform removed company member'));
 await rejects(remove(root,member,'viewer'),409);
});

test('platform pending invitations can be revoked without membership or loss of previous audit',async t=>{
 const h=harness(t),id=await ready(h),recipient=actor('pending-recipient');await h.read(recipient);
 await h.execute(owner,{type:'invite-member',organizationId:id,email:recipient.user.email,role:'operator'});const detail=(await h.read(root,{view:'platform',organizationId:id})).platform.company;assert.equal(detail.invitations.length,1);
 const cmd={type:'platform-revoke-company-invitation',organizationId:id,invitationId:detail.invitations[0].id};await rejects(h.execute(recipient,cmd),403);await h.execute(root,cmd);
 assert.equal((await h.read(root,{view:'platform',organizationId:id})).platform.company.invitations.length,0);await rejects(h.execute(recipient,{type:'accept-invitation',invitationId:cmd.invitationId}),403);await rejects(h.execute(root,cmd),409);
});

test('campaign lifecycle is role guarded, revision protected, audited and hidden from public discovery',async t=>{
 const h=harness(t),id=await ready(h),cid=await draftCampaign(h,id),operator=actor('editor'),viewer=actor('reader');
 for(const [person,role]of [[operator,'operator'],[viewer,'viewer']]){await h.read(person);await h.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:person.user.email,role});}
 const get=async()=> (await h.read(owner,{view:'company',organizationId:id})).state.campaigns.find(c=>c.id===cid);
 const update=async(person,input,revision)=>h.execute(person,{type:'edit-campaign',organizationId:id,campaignId:cid,campaignRevision:revision??((await get()).revision||0),input});
 const initial=await get(),input={...initial,name:'Revised draft'};for(const key of ['id','status','token','platform','revision'])delete input[key];
 await rejects(update(viewer,input),403);await update(operator,input);await rejects(update(owner,input,0),409);
 const remove={type:'delete-draft',organizationId:id,campaignId:cid,campaignRevision:(await get()).revision};await rejects(h.execute(operator,remove),403);await h.execute(owner,remove);assert.equal((await get()).status,'deleted');assert.equal((await h.read(investor,{view:'shareholder'})).state.campaigns.length,0);
 await h.execute(owner,{type:'restore-draft',organizationId:id,campaignId:cid,campaignRevision:(await get()).revision});await h.execute(owner,{type:'open',organizationId:id,campaignId:cid});assert.equal((await h.read(investor,{view:'shareholder'})).state.campaigns.length,1);
 await rejects(update(owner,{budget:1}),422);await update(owner,{name:'Public revised name',description:'Public revised description'});
 await h.execute(owner,{type:'archive-campaign',organizationId:id,campaignId:cid,campaignRevision:(await get()).revision});assert.equal((await get()).status,'archived');assert.equal((await h.read(investor,{view:'shareholder'})).state.campaigns.length,0);
 await rejects(h.execute(root,{type:'platform-campaign-control',organizationId:id,campaignId:cid,revision:0,action:'show',note:'Cannot expose archived activity.'}),422);
 const audit=(await h.read(owner,{view:'company',organizationId:id})).team.audit;for(const type of ['edit-campaign','delete-draft','restore-draft','archive-campaign'])assert.ok(audit.some(a=>a.action==='Campaign '+type));
});

test('account invitations create no fake identity or privileges and bind acceptance to verified email',async t=>{
 const h=harness(t);await h.read(root);const email='new-invite@example.com',recipient={...actor('new-recipient'),user:{...actor('new-recipient').user,email}};
 await rejects(h.execute(owner,{type:'platform-invite-account',email}),403);await h.execute(root,{type:'platform-invite-account',email:email.toUpperCase(),role:'owner'});
 let view=await h.read(root,{view:'platform'});assert.equal(view.platform.accountInvitations[0].email,email);assert.equal((await h.DB.query('SELECT id FROM cc_accounts WHERE email=$1',[email])).length,0);
 await rejects(h.execute(root,{type:'platform-invite-account',email}),409);await h.read(stranger);assert.equal((await h.read(root,{view:'platform'})).platform.accountInvitations.length,1);
 const data=await h.read(recipient);assert.equal(data.access.platformRole,null);assert.deepEqual(data.access.organizations,[]);assert.equal(data.access.onboarded,false);assert.equal((await h.read(root,{view:'platform'})).platform.accountInvitations.length,0);
 assert.equal((await h.DB.query('SELECT status,accepted_by FROM cc_account_invitations WHERE email=$1',[email]))[0].accepted_by,recipient.accountId);await rejects(h.execute(root,{type:'platform-invite-account',email}),409);
});

test('account invitation revocation and expiry never grant access or accept a stale invitation',async t=>{
 const h=harness(t);await h.read(root);const recipient=actor('expired-invite'),email=recipient.user.email;await h.execute(root,{type:'platform-invite-account',email});let invitation=(await h.read(root,{view:'platform'})).platform.accountInvitations[0];
 await h.DB.query("UPDATE cc_account_invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1",[invitation.id]);await h.execute(root,{type:'platform-invite-account',email});const next=(await h.read(root,{view:'platform'})).platform.accountInvitations[0];assert.notEqual(next.id,invitation.id);
 await rejects(h.execute(stranger,{type:'platform-revoke-account-invitation',invitationId:next.id}),403);await h.execute(root,{type:'platform-revoke-account-invitation',invitationId:next.id});await h.read(recipient);
 const rows=await h.DB.query('SELECT id,status FROM cc_account_invitations WHERE email=$1',[email]);assert.equal(rows.find(i=>i.id===invitation.id).status,'expired');assert.equal(rows.find(i=>i.id===next.id).status,'revoked');assert.equal((await h.read(recipient)).access.platformRole,null);
});

test('removing and restoring portal access preserves company membership, personal rewards and history',async t=>{
 const h=harness(t),id=await ready(h),person=actor('removable-account');await h.read(person);await h.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:person.user.email,role:'viewer'});
 await h.execute(person,{type:'kyc',name:'Personal record retained',email:'demo@example.com',country:'Hong Kong',consent:true});const before=await h.read(person,{view:'company',organizationId:id});
 const cmd={type:'platform-remove-account',accountId:person.accountId,revision:0,note:'Synthetic portal removal test.'};await rejects(h.execute(owner,cmd),403);await rejects(h.execute(root,{...cmd,accountId:root.accountId}),403);await h.execute(root,cmd);
 await assert.rejects(h.read(person),e=>e.status===403&&e.code==='ACCOUNT_REMOVED');await assert.rejects(h.documents.download(person,'any'),e=>e.code==='ACCOUNT_REMOVED');
 assert.ok(!(await h.read(root,{view:'platform'})).platform.accounts.some(a=>a.id===person.accountId));const removed=(await h.read(root,{view:'platform',accountFilter:'removed'})).platform.accounts.find(a=>a.id===person.accountId);assert.equal(removed.status,'removed');assert.equal(removed.control_revision,1);
 await rejects(h.execute(root,{type:'platform-account-status',accountId:person.accountId,status:'active',revision:0,note:'Stale legacy restore alias.'}),409);
 await rejects(h.execute(root,{type:'platform-restore-account',accountId:person.accountId,revision:0,note:'Stale restoration attempt.'}),409);await h.execute(root,{type:'platform-restore-account',accountId:person.accountId,revision:1,note:'Restore synthetic portal access.'});
 const after=await h.read(person,{view:'company',organizationId:id});assert.equal(after.context.role,'viewer');assert.equal(after.state.profile.name,'Personal record retained');assert.deepEqual(after.state.treasury,before.state.treasury);assert.equal((await h.read(root,{view:'platform',accountFilter:'removed'})).platform.accounts.length,0);
});


test('account lifecycle migration upgrades an existing database without changing prior users or controls',t=>{
 const dir=mkdtempSync(join(tmpdir(),'currenc-account-upgrade-')),path=join(dir,'old.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));const old=new DatabaseSync(path);
 for(const file of ['0000_workspace.sql','0001_platform.sql','0002_governance.sql'])old.exec(readFileSync('drizzle/'+file,'utf8'));
 old.prepare('INSERT INTO cc_accounts (id,email,name,profile,activity,onboarded,created_at) VALUES (?,?,?,?,?,?,?)').run('preserved','preserved@example.com','Preserved','{}','[]',1,'2026-01-01');old.prepare('INSERT INTO cc_account_controls (account_id,status,reason,revision,updated_at) VALUES (?,?,?,?,?)').run('preserved','suspended','Existing reason',7,'2026-01-01');old.close();
 for(let i=0;i<2;i++){const DB=createSqliteDatabase(path);const row=DB.db.prepare('SELECT * FROM cc_account_controls WHERE account_id=?').get('preserved');assert.equal(row.archived,0);assert.equal(row.status,'suspended');assert.equal(row.revision,7);assert.equal(row.reason,'Existing reason');DB.close();}
});

test('account role summaries are staff-only metadata scoped to the displayed accounts',async t=>{
 const h=harness(t),id=await ready(h);await h.read(investor);await h.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:investor.user.email,role:'admin'});
 const view=await h.read(root,{view:'platform',search:investor.user.email}),rows=view.platform.accounts;assert.equal(rows.length,1);assert.deepEqual(rows[0].companyRoles,[{organizationId:id,name:'Test Company',role:'admin'}]);assert.deepEqual(Object.keys(rows[0].companyRoles[0]).sort(),['name','organizationId','role']);
 await rejects(h.read(investor,{view:'platform'}),403);const personal=await h.read(investor,{view:'shareholder'});assert.equal(personal.platform,null);assert.ok(!JSON.stringify(personal).includes('companyRoles'));
});

test('account search uses only allowed completed identity fields and keeps login identity separate',async t=>{
 const h=harness(t);await h.read(root);await h.read(investor);await h.read(stranger);
 await h.execute(investor,{type:'kyc',name:'Casey Identity',email:'profile-only@example.test',country:'Singapore',consent:true});
 await h.execute(stranger,{type:'kyc',name:'Literal%_! Profile',email:'other-profile@example.test',country:'Taiwan',consent:true});
 const row=(await h.DB.query('SELECT profile FROM cc_accounts WHERE id=$1',[investor.accountId]))[0];
 await h.DB.query('UPDATE cc_accounts SET profile=$1 WHERE id=$2',[JSON.stringify({...JSON.parse(row.profile),passport:'PRIVATE-NOT-SEARCHABLE',providerSecret:'NOT-RETURNED'}),investor.accountId]);
 for(const search of ['casey identity','PROFILE-ONLY@EXAMPLE.TEST','singapore',investor.user.email]){
  const data=await h.read(root,{view:'platform',search}),accounts=data.platform.accounts;assert.equal(accounts.length,1);assert.equal(accounts[0].id,investor.accountId);assert.equal(accounts[0].email,investor.user.email);assert.equal(accounts[0].name,investor.user.name);
  assert.deepEqual(accounts[0].identityProfile,{name:'Casey Identity',email:'profile-only@example.test',country:'Singapore',complete:true,simulated:true});assert.ok(!JSON.stringify(data.platform).includes('PRIVATE-NOT-SEARCHABLE'));assert.ok(!JSON.stringify(data.platform).includes('NOT-RETURNED'));assert.ok(!Object.hasOwn(accounts[0],'identity_data'));
 }
 for(const search of ['PRIVATE-NOT-SEARCHABLE','providerSecret',"' OR 1=1 --",'Hong Kong'])assert.equal((await h.read(root,{view:'platform',search})).platform.accounts.length,0);
 const literal=(await h.read(root,{view:'platform',search:'%_!'})).platform.accounts;assert.deepEqual(literal.map(a=>a.id),[stranger.accountId]);
 await h.execute(root,{type:'platform-remove-account',accountId:investor.accountId,revision:0,note:'Synthetic disabled profile search.'});
 assert.equal((await h.read(root,{view:'platform',search:'casey'})).platform.accounts.length,0);assert.equal((await h.read(root,{view:'platform',search:'casey',accountFilter:'removed'})).platform.accounts[0].id,investor.accountId);
 await rejects(h.read(stranger,{view:'platform',search:'casey'}),403);assert.equal((await h.read(stranger,{view:'shareholder'})).platform,null);
});

test('legacy suspended accounts share Disabled recovery without automatic reactivation or new suspended writes',async t=>{
 const h=harness(t),id=await ready(h),person=actor('legacy-suspended');await h.read(person);await h.execute(root,{type:'platform-company-admin',organizationId:id,memberEmail:person.user.email,role:'viewer'});
 await h.execute(person,{type:'kyc',name:'Legacy Profile',email:'legacy-profile@example.test',country:'Hong Kong',consent:true});
 await h.DB.query("INSERT INTO cc_account_controls (account_id,status,archived,reason,revision,updated_at) VALUES ($1,'suspended',0,'Historical reason',7,$2)",[person.accountId,new Date().toISOString()]);
 assert.ok(!(await h.read(root,{view:'platform'})).platform.accounts.some(a=>a.id===person.accountId));const legacy=(await h.read(root,{view:'platform',accountFilter:'removed',search:'Legacy Profile'})).platform.accounts[0];assert.equal(legacy.id,person.accountId);assert.equal(legacy.status,'removed');assert.equal(legacy.control_revision,7);
 await assert.rejects(h.read(person),e=>e.status===403&&e.code==='ACCOUNT_SUSPENDED');const raw=(await h.DB.query('SELECT status,archived,revision FROM cc_account_controls WHERE account_id=$1',[person.accountId]))[0];assert.deepEqual({...raw},{status:'suspended',archived:0,revision:7});
 await rejects(h.execute(root,{type:'platform-restore-account',accountId:person.accountId,revision:6,note:'Stale restore.'}),409);
 await h.execute(root,{type:'platform-restore-account',accountId:person.accountId,revision:7,note:'Explicitly restore legacy disabled account.'});assert.equal((await h.read(person,{view:'company',organizationId:id})).context.role,'viewer');assert.equal((await h.read(person)).state.profile.name,'Legacy Profile');
 await h.execute(root,{type:'platform-account-status',accountId:person.accountId,status:'suspended',revision:8,note:'Legacy client alias uses unified disable.'});const disabled=(await h.DB.query('SELECT status,archived,revision FROM cc_account_controls WHERE account_id=$1',[person.accountId]))[0];assert.deepEqual({...disabled},{status:'active',archived:1,revision:9});await assert.rejects(h.read(person),e=>e.code==='ACCOUNT_REMOVED');
 await h.execute(root,{type:'platform-account-status',accountId:person.accountId,status:'active',revision:9,note:'Legacy client alias uses unified restore.'});assert.equal((await h.read(person,{view:'company',organizationId:id})).context.role,'viewer');
});
