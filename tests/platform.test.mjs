import test from 'node:test';
import {verifiedTestWallet} from './helpers/wallets.mjs';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {seedState,applyCommand} from '../lib/domain.ts';

const actor=id=>({accountId:'account-'+id,user:{id,email:id+'@example.com',name:id,emailVerified:true}});
function harness(t) {
  const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());
  let date=new Date();const platform=createPlatform(DB,{now:()=>date});
  return {DB,...platform,advance(days){date=new Date(date.getTime()+days*86400000);}};
}
async function company(h,owner,name='Test company') {
  await h.read(owner);await h.DB.query("INSERT INTO cc_platform_admins (account_id,role,created_at) VALUES ($1,'admin',$2)",[owner.accountId,new Date().toISOString()]);const selected=await h.execute(owner,{type:'platform-create-company',name,ticker:'TEST',token:'TST'});await h.DB.query('DELETE FROM cc_platform_admins WHERE account_id=$1',[owner.accountId]);
  // Membership/domain tests use staff-created, listed fixtures. Staff registration
  // and the disabled self-service routes are exercised by governance tests.
  await h.DB.query("UPDATE cc_company_status SET status='approved',visible=1,was_approved=1 WHERE organization_id=$1",[selected.organizationId]);
  return selected.organizationId;
}
async function campaign(h,owner,id) {
  const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  await h.execute(owner,{type:'create',organizationId:id,input:{company:id,name:'Rewards',description:'Test campaign',mode:'ratio',ratio:0.1,budget:10000,minimum:100,cap:10000,release:100,snapshotDate:today,deadline,distribution:'claim',chains:['ETH','SOL','BNB']}});
  const view=await h.read(owner,{view:'company',organizationId:id});return view.state.campaigns.at(-1).id;
}
async function invite(h,owner,org,recipient,role) {
  await h.read(recipient);
  await h.execute(owner,{type:'invite-member',organizationId:org,email:recipient.user.email.toUpperCase(),role});
  const view=await h.read(recipient,{view:'shareholder'});return view.access.invitations.find(i=>i.company==='Test company')?.id||view.access.invitations.at(-1)?.id;
}
async function joinTeam(h,owner,org,recipient,role) {
  const id=await invite(h,owner,org,recipient,role);await h.execute(recipient,{type:'accept-invitation',invitationId:id});return id;
}
const denied=promise=>assert.rejects(promise,error=>error instanceof PlatformError&&error.status===403);
const identity=async(h,user)=>h.execute(user,{type:'kyc',name:user.user.name,email:'demo@example.com',country:'Hong Kong',consent:true});

test('new accounts onboard without sample companies; only creators own a company, even when names match',async t=>{
  const h=harness(t),a=actor('owner'),b=actor('outsider');
  const first=await h.read(a);assert.equal(first.access.onboarded,false);assert.deepEqual(first.access.organizations,[]);assert.deepEqual(first.state.holders,[]);
  const org=await company(h,a,'Same name'),other=await company(h,b,'Same name');assert.notEqual(org,other);
  const owned=await h.read(a,{view:'company',organizationId:org});assert.equal(owned.context.role,'owner');assert.equal(owned.state.campaigns.length,0);assert.equal(owned.state.treasury[org].ETH,0);
  await denied(h.read(b,{view:'company',organizationId:org}));
  await denied(h.execute(b,{type:'fund',organizationId:org,company:org,chain:'ETH',amount:100}));
  await denied(h.execute(a,{type:'fund',organizationId:org,company:other,chain:'ETH',amount:100}));
  await denied(h.execute(a,{type:'reset',organizationId:org}));
});

test('invitations require the verified recipient, expire, revoke, and cannot be replayed after removal',async t=>{
  const h=harness(t),owner=actor('owner'),member=actor('member'),stranger=actor('stranger');const org=await company(h,owner);
  let id=await invite(h,owner,org,member,'operator');
  await denied(h.execute(stranger,{type:'accept-invitation',invitationId:id,email:member.user.email,accountId:member.accountId}));
  assert.equal((await h.read(stranger)).access.invitations.length,0);
  await h.execute(owner,{type:'revoke-invitation',organizationId:org,invitationId:id});
  await denied(h.execute(member,{type:'accept-invitation',invitationId:id}));
  id=await invite(h,owner,org,member,'operator');h.advance(8);
  await denied(h.execute(member,{type:'accept-invitation',invitationId:id}));
  assert.equal((await h.read(member)).access.invitations.length,0);
  id=await invite(h,owner,org,member,'viewer');
  await h.execute(member,{type:'accept-invitation',invitationId:id});
  assert.equal((await h.read(member,{view:'company',organizationId:org})).context.role,'viewer');
  await h.execute(owner,{type:'remove-member',organizationId:org,memberId:member.accountId});
  await denied(h.read(member,{view:'company',organizationId:org}));
  await denied(h.execute(member,{type:'accept-invitation',invitationId:id}));
  await denied(h.read(member,{view:'company',organizationId:org}));
});

test('owner, admin, operator and viewer permissions are enforced by the server, with atomic team audit',async t=>{
  const h=harness(t),owner=actor('owner'),admin=actor('admin'),operator=actor('operator'),viewer=actor('viewer');const org=await company(h,owner);
  await joinTeam(h,owner,org,admin,'admin');await joinTeam(h,owner,org,operator,'operator');await joinTeam(h,owner,org,viewer,'viewer');
  for(const member of [operator,viewer]) {
    await denied(h.execute(member,{type:'fund',organizationId:org,company:org,chain:'ETH',amount:100,role:'owner'}));
    await denied(h.execute(member,{type:'invite-member',organizationId:org,email:'new@example.com',role:'admin'}));
    assert.equal((await h.read(member,{view:'company',organizationId:org})).team,null);
  }
  const cid=await campaign(h,operator,org);
  await denied(h.execute(viewer,{type:'open',organizationId:org,campaignId:cid}));
  await h.execute(admin,{type:'fund',organizationId:org,company:org,chain:'ETH',amount:100});
  await denied(h.execute(admin,{type:'change-member-role',organizationId:org,memberId:operator.accountId,role:'admin'}));
  await denied(h.execute(admin,{type:'remove-member',organizationId:org,memberId:owner.accountId}));
  await denied(h.execute(owner,{type:'change-member-role',organizationId:org,memberId:owner.accountId,role:'viewer'}));
  await h.execute(owner,{type:'change-member-role',organizationId:org,memberId:operator.accountId,role:'viewer'});
  await denied(h.execute(operator,{type:'open',organizationId:org,campaignId:cid}));
  const view=await h.read(owner,{view:'company',organizationId:org});
  assert.equal(view.state.treasury[org].ETH,100);
  assert.ok(view.team.audit.some(a=>a.action==='Member role changed'));
  const count=view.team.audit.length;
  await denied(h.execute(viewer,{type:'remove-member',organizationId:org,memberId:operator.accountId}));
  assert.equal((await h.read(owner,{view:'company',organizationId:org})).team.audit.length,count);
});

test('simultaneous invitations and acceptances create one pending invite and one membership',async t=>{
  const h=harness(t),owner=actor('owner'),member=actor('member');const org=await company(h,owner);
  await h.read(member);
  const results=await Promise.allSettled([1,2].map(()=>h.execute(owner,{type:'invite-member',organizationId:org,email:member.user.email,role:'viewer'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const invitation=(await h.read(member)).access.invitations[0];
  const accepted=await Promise.allSettled([1,2].map(()=>h.execute(member,{type:'accept-invitation',invitationId:invitation.id})));
  assert.equal(accepted.filter(r=>r.status==='fulfilled').length,1);
  const team=(await h.read(owner,{view:'company',organizationId:org})).team;
  assert.equal(team.members.filter(m=>m.id===member.accountId).length,1);
  assert.equal(team.audit.filter(a=>a.action==='Invitation accepted').length,1);
});

test('shareholders see only their own registrations, wallets and payouts; concurrent claims cannot spend another allocation',async t=>{
  const h=harness(t),owner=actor('owner'),alice=actor('alice'),bob=actor('bob');const org=await company(h,owner);
  const cid=await campaign(h,owner,org);
  assert.equal((await h.read(alice,{view:'shareholder'})).state.campaigns.length,0);
  await h.execute(owner,{type:'open',organizationId:org,campaignId:cid});
  const walletFixtures=new Map();
  for(const [user,shares,wallet] of [[alice,5000,'0x'+'1'.repeat(40)],[bob,10000,'0x'+'2'.repeat(40)]]) {
    await identity(h,user);await h.execute(user,{type:'verify',organizationId:org,campaignId:cid,shares,source:'manual',accountId:owner.accountId});
    const verified=await verifiedTestWallet(h.DB,h,user);walletFixtures.set(user.accountId,verified);
    await h.execute(user,{type:'wallet',organizationId:org,campaignId:cid,walletId:verified.id,walletRevision:verified.revision});
  }
  let adminView=await h.read(owner,{view:'company',organizationId:org});
  assert.equal(adminView.state.holders.length,2);
  const bHolder=adminView.state.holders.find(h=>h.name==='bob');
  const replacement=await verifiedTestWallet(h.DB,h,alice);await h.execute(alice,{type:'wallet',organizationId:org,campaignId:cid,holderId:bHolder.id,walletId:replacement.id,walletRevision:replacement.revision});
  adminView=await h.read(owner,{view:'company',organizationId:org});
  assert.equal(adminView.state.holders.find(h=>h.name==='bob').wallet,walletFixtures.get(bob.accountId).address);
  for(const holder of adminView.state.holders)await h.execute(owner,{type:'review',organizationId:org,holderId:holder.id,approved:true});
  await h.execute(owner,{type:'fund',organizationId:org,company:org,chain:'ETH',amount:5000});
  await h.execute(owner,{type:'snapshot',organizationId:org,campaignId:cid});
  const responses=await Promise.allSettled([h.execute(alice,{type:'claim',organizationId:org,campaignId:cid,holderId:bHolder.id}),h.execute(alice,{type:'claim',organizationId:org,campaignId:cid})]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
  const aView=await h.read(alice,{view:'shareholder'}),bView=await h.read(bob,{view:'shareholder'});
  assert.equal(aView.state.holders.length,1);assert.equal(aView.state.holders[0].name,'alice');assert.equal(aView.state.transactions[0].amount,500);
  assert.equal(bView.state.holders[0].claimed,0);assert.equal(bView.state.transactions.length,0);
  assert.deepEqual(aView.state.treasury,{});assert.ok(aView.state.activity.every(a=>a.title==='Demo identity completed'));
  assert.doesNotMatch(JSON.stringify(aView.state),/bob|0x222222|account-bob|Holdings review/);
  assert.equal(aView.state.holders[0].accountId,undefined);
  assert.equal((await h.read(owner,{view:'company',organizationId:org})).state.treasury[org].ETH,4500);
  await denied(h.execute(alice,{type:'snapshot',organizationId:org,campaignId:cid}));
});

test('companies cannot review or mutate another company campaign, even if both companies belong to the caller',async t=>{
  const h=harness(t),owner=actor('owner');const a=await company(h,owner),b=await company(h,owner,'Second company');const cid=await campaign(h,owner,b);
  await denied(h.execute(owner,{type:'open',organizationId:a,campaignId:cid}));
  await denied(h.execute(owner,{type:'create',organizationId:a,input:{company:b}}));
  assert.equal((await h.read(owner,{view:'company',organizationId:a})).state.campaigns.length,0);
});

test('legacy migration preserves balances, allocations and owner identity exactly once without leaking old cross-company audit',async t=>{
  const h=harness(t),owner=actor('owner'),member=actor('member');let legacy=seedState();
  legacy=applyCommand(legacy,{type:'kyc',name:'Old investor',email:'demo@example.com',country:'Hong Kong',consent:true});
  legacy=applyCommand(legacy,{type:'verify',campaignId:'curr-welcome',shares:5000,source:'broker'});
  legacy.treasury.curr.ETH=25001;legacy.activity.unshift({id:'old-secret',at:new Date().toISOString(),title:'Old private event',detail:'Other company private details',kind:'info'});
  await h.DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(owner.accountId,JSON.stringify(legacy)).run();
  await Promise.all([h.read(owner),h.read(owner)]);
  let view=await h.read(owner);
  assert.equal(view.access.organizations.length,3);
  const org=view.access.organizations.find(o=>o.ticker==='CURR').id;
  view=await h.read(owner,{view:'company',organizationId:org});
  assert.equal(view.state.treasury[org].ETH,25001);assert.equal(view.state.holders.filter(h=>h.self).length,1);assert.equal(view.state.profile.name,'Old investor');
  await joinTeam(h,owner,org,member,'viewer');
  const memberView=await h.read(member,{view:'company',organizationId:org});
  assert.doesNotMatch(JSON.stringify(memberView.state.activity),/Other company private details/);
  assert.ok((await h.read(owner,{view:'shareholder'})).state.activity.some(a=>a.id==='old-secret'));
  const archive=await h.DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(owner.accountId).first();assert.deepEqual(JSON.parse(archive.data),legacy);
});
