import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState,applyCommand,allocate,claimable} from '../lib/domain.ts';
const campaignId='curr-welcome';
const run=(s,type,extra={})=>applyCommand(s,{type,campaignId,...extra});
function investor(s=seedState(),source='broker'){
 s=run(s,'kyc',{name:'Demo Investor',email:'demo@example.com',country:'Hong Kong',consent:true});
 s=run(s,'verify',{shares:5000,source});
 return run(s,'wallet',{chain:'ETH',wallet:'0x4444444444444444444444444444444444444444'});
}
function ready(s=investor()){
 s=run(s,'review',{holderId:'sample-iris',approved:true});
 return run(s,'snapshot');
}
test('end-to-end: verify, approve, snapshot, claim and treasury reconcile',()=>{
 let s=ready();const before=s.treasury.curr.ETH;
 const holder=s.holders.find(h=>h.id==='self-'+campaignId);
 assert.equal(holder.allocation,500);assert.equal(s.campaigns[0].status,'locked');
 s=run(s,'claim');assert.equal(s.treasury.curr.ETH,before-500);
 assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].amount,500);
 assert.equal(s.holders.find(h=>h.id===holder.id).claimed,500);
 assert.throws(()=>run(s,'claim'),/No claimable allocation/);
 assert.throws(()=>run(s,'wallet',{chain:'BNB',wallet:'0x5555555555555555555555555555555555555555'}),/cannot change/);
});
test('eligibility: requires KYC, minimum, one registration and completed manual review',()=>{
 assert.throws(()=>run(seedState(),'verify',{shares:5000,source:'broker'}),/KYC/);
 let s=run(seedState(),'kyc',{name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:true});
 assert.throws(()=>run(s,'verify',{shares:10,source:'broker'}),/minimum shares/);
 s=investor(seedState(),'manual');assert.throws(()=>run(s,'verify',{shares:5000,source:'broker'}),/Duplicate/);
 assert.throws(()=>run(s,'snapshot'),/pending reviews/);
 s=run(s,'review',{holderId:'sample-iris',approved:true});
 s=run(s,'review',{holderId:'self-'+campaignId,approved:false});
 s=run(s,'snapshot');assert.equal(s.holders.find(h=>h.id==='self-'+campaignId).allocation,0);
});
test('fixed pool distributes only among eligible shares and respects per-person cap',()=>{
 const s=seedState(),c={...s.campaigns[0],mode:'pool',budget:100,cap:100};
 const hs=s.holders.filter(h=>h.status==='verified');
 const rows=allocate(c,hs);assert.ok(rows.reduce((sum,r)=>sum+r.amount,0)<=100);
 assert.equal(rows.find(r=>r.id==='sample-grace').amount,30);
 assert.equal(rows.find(r=>r.id==='sample-marcus').amount,20);
 assert.equal(rows.find(r=>r.id==='sample-theo').amount,50);
 assert.equal(allocate({...c,cap:10},hs).reduce((sum,r)=>sum+r.amount,0),30);
 assert.throws(()=>allocate({...c,mode:'ratio',budget:1},hs),/exceeds the campaign budget/);
});
test('incremental release never reallocates or reclaims amounts already paid',()=>{
 let s=investor();s.campaigns[0].release=25;s=ready(s);s=run(s,'claim');
 assert.equal(s.transactions[0].amount,125);
 s=run(s,'release',{percent:60});s=run(s,'claim');assert.equal(s.transactions[0].amount,175);
 s=run(s,'release',{percent:100});s=run(s,'claim');assert.equal(s.transactions[0].amount,200);
 assert.equal(s.holders.find(h=>h.id==='self-'+campaignId).claimed,500);
 assert.throws(()=>run(s,'release',{percent:25}),/must be between/);
});
test('pause, expiry and insufficient funds prevent any payout',()=>{
 let s=ready();const original=JSON.stringify(s);s=run(s,'pause');
 assert.throws(()=>run(s,'claim'),/not paused/);s=run(s,'pause');s.treasury.curr.ETH=1;
 assert.throws(()=>run(s,'claim'),/insufficient test funds/);assert.equal(s.transactions.length,0);
 const fresh=JSON.parse(original);fresh.campaigns[0].deadline='2000-01-01';assert.throws(()=>run(fresh,'claim'),/deadline/);
});
test('batch distribution is atomic across chains and cannot double pay',()=>{
 let s=ready();s.campaigns[0].distribution='push';s.treasury.curr.SOL=0;
 assert.throws(()=>run(s,'distribute'),/insufficient test funds/);assert.equal(s.transactions.length,0);
 s=run(s,'fund',{company:'curr',chain:'SOL',amount:1000});s=run(s,'distribute');
 assert.equal(s.transactions.length,5);assert.equal(s.transactions.reduce((sum,t)=>sum+t.amount,0),5000);
 assert.throws(()=>run(s,'distribute'),/No claimable allocation/);
});
test('server rejects arbitrary chains, invalid addresses and post-snapshot enrollment',()=>{
 let s=investor();assert.throws(()=>run(s,'wallet',{chain:'DOGE',wallet:'test'}),/not supported/);
 assert.throws(()=>run(s,'wallet',{chain:'ETH',wallet:'not-an-address'}),/format/);
 s=ready(s);assert.throws(()=>run(s,'review',{holderId:'sample-iris',approved:false}),/snapshot/);
 assert.throws(()=>run(s,'verify',{shares:5000,source:'broker'}),/open/);
});
test('create pool draft, open registration, reject overbudget snapshot and future dates',()=>{
 let s=seedState();const input={...s.campaigns[0],name:'Test campaign',company:'curr',mode:'pool'};
 s=run(s,'create',{input});const c=s.campaigns[0];assert.equal(c.status,'draft');
 s=applyCommand(s,{type:'open',campaignId:c.id});assert.equal(s.campaigns[0].status,'open');
 const future=new Date(Date.now()+86400000).toISOString().slice(0,10);
 s.campaigns[0].snapshotDate=future;
 assert.throws(()=>applyCommand(s,{type:'snapshot',campaignId:c.id}),/not been reached/);
 assert.throws(()=>run(s,'create',{input:{...input,chains:[]}}),/at least one/);
});
