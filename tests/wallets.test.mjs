import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {NEON_AUTH_SESSION_COOKIE_NAME} from '@neondatabase/auth/server';
import bs58 from 'bs58';
import {ed25519} from '@noble/curves/ed25519.js';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {createWallets,normalizeWallet,createWalletHandler} from '../server/wallets.mjs';
import {createVercelWalletHandler} from '../server/vercel-wallets.mjs';
import {accountWorkspaceId} from '../server/vercel-workspace.mjs';
import {testSigner} from './helpers/wallets.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
const issuer='https://auth.wallet.example.test/auth',origin='https://wallet.example.test';
const actor=id=>({accountId:accountWorkspaceId(issuer,id),issuer,sessionHash:createHash('sha256').update('wallet-test-'+id).digest('hex'),user:{id,name:id,email:id+'@example.test',emailVerified:true}});
const root=actor('root'),alice=actor('alice'),bob=actor('bob');
const reject=(promise,status)=>assert.rejects(promise,e=>e instanceof PlatformError&&e.status===status);
function harness(t){const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());let time=new Date();const options={now:()=>time,bootstrapOwner:{email:root.user.email,issuer}},platform=createPlatform(DB,options),wallets=createWallets(DB,platform,options);return {DB,platform,wallets,options,advance(ms){time=new Date(time.getTime()+ms);}};}
async function verify(h,person=alice,chain='ETH',signer=testSigner(chain)){
 const challenge=await h.wallets.challenge(person,origin,{chain,address:signer.address}),signature=await signer.sign(challenge.message),wallet=await h.wallets.verify(person,origin,{challengeId:challenge.id,signature});return {wallet,challenge,signature,signer};
}
async function campaign(h,chains=['ETH','SOL','BNB']){
 await h.platform.read(root);const {organizationId}=await h.platform.execute(root,{type:'platform-create-company',name:'Wallet QA',ticker:'WQA',token:'TEST'});
 const status=await h.platform.governance.application(root,organizationId);await h.platform.execute(root,{type:'platform-review-company',organizationId,revision:status.revision,action:'show',note:'Synthetic wallet workflow.'});
 const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+86400000*30).toISOString().slice(0,10);
 await h.platform.execute(root,{type:'create',organizationId,input:{company:organizationId,name:'Wallet rewards',description:'Synthetic wallet workflow only',mode:'ratio',ratio:0.1,budget:10000,minimum:100,cap:1000,release:50,snapshotDate:today,deadline,distribution:'claim',chains}});
 const campaignId=(await h.platform.read(root,{view:'company',organizationId})).state.campaigns[0].id;await h.platform.execute(root,{type:'open',organizationId,campaignId});
 await h.platform.execute(alice,{type:'kyc',name:'Synthetic shareholder',email:'demo@example.test',country:'Hong Kong',consent:true});await h.platform.execute(alice,{type:'verify',organizationId,campaignId,source:'broker',shares:1000});
 return {organizationId,campaignId};
}
test('ETH, BNB and Solana ownership uses real signatures independently of KYC and holdings',async t=>{
 const h=harness(t);
 for(const chain of ['ETH','BNB','SOL']){
  const {wallet,challenge}=await verify(h,alice,chain);assert.equal(wallet.chain,chain);assert.equal(challenge.chain,chain);assert.match(challenge.message,/Nonce: [0-9a-f]{48}/);assert.match(challenge.message,/wallet.example.test/);assert.ok(challenge.message.includes('Chain ID: '+({ETH:1,BNB:56,SOL:'solana:mainnet'}[chain])));
 }
 const data=await h.platform.read(alice,{view:'shareholder'});assert.equal(data.state.profile.kyc,false);assert.equal(data.state.holders.length,0);assert.equal(data.wallets.length,3);
 assert.deepEqual(Object.keys(data.wallets[0]).sort(),['address','chain','id','revision','verifiedAt']);assert.equal((await h.platform.read(bob,{view:'shareholder'})).wallets.length,0);
 assert.ok(!JSON.stringify(data).includes('Nonce:'));assert.ok(!JSON.stringify(await readPublicCampaigns(h.DB)).includes('wallet-'));
});
test('wallet challenges cannot be replayed, used for another account/session/origin, or signed by a different key',async t=>{
 const h=harness(t),signer=testSigner(),challenge=await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address}),signature=await signer.sign(challenge.message),input={challengeId:challenge.id,signature};
 for(const [person,host] of [[bob,origin],[{...alice,sessionHash:'another-authenticated-session-hash'},origin],[alice,'https://other.example.test']])await reject(h.wallets.verify(person,host,input),409);
 await reject(h.wallets.verify(alice,origin,{...input,signature:await testSigner().sign(challenge.message)}),422);
 await reject(h.wallets.verify(alice,origin,{...input,signature:await signer.sign(challenge.message.replace('Chain ID: 1','Chain ID: 56'))}),422);
 await h.wallets.verify(alice,origin,input);await reject(h.wallets.verify(alice,origin,input),409);
 assert.equal((await h.DB.query('SELECT id FROM cc_wallet_proofs')).length,1);
});
test('expired challenges, excessive attempts and excessive requests are rejected',async t=>{
 const h=harness(t),signer=testSigner(),challenge=await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address});h.advance(300001);await reject(h.wallets.verify(alice,origin,{challengeId:challenge.id,signature:await signer.sign(challenge.message)}),409);
 const fresh=await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address});for(let attempt=0;attempt<5;attempt++)await reject(h.wallets.verify(alice,origin,{challengeId:fresh.id,signature:'0x'+'0'.repeat(130)}),422);
 await reject(h.wallets.verify(alice,origin,{challengeId:fresh.id,signature:await signer.sign(fresh.message)}),409);
 for(let i=2;i<20;i++)await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address});await reject(h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address}),429);
});
test('invalid networks, malformed addresses and small-order or program Solana addresses cannot be verified',async t=>{
 const h=harness(t);for(const [chain,address] of [['BTC','x'],['ETH','0x123'],['SOL','not-base58'],['SOL','11111111111111111111111111111111'],['SOL',bs58.encode(Uint8Array.from([1,...new Array(31).fill(0)]))]])await reject(h.wallets.challenge(alice,origin,{chain,address}),422);
 assert.throws(()=>normalizeWallet('SOL',bs58.encode(new Uint8Array(32).fill(255))),PlatformError);
 assert.throws(()=>normalizeWallet('ETH','<script>'),PlatformError);
});
test('concurrent verification consumes one nonce; audit failure rolls back nonce, registry and proof',async t=>{
 const h=harness(t),signer=testSigner(),challenge=await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address}),input={challengeId:challenge.id,signature:await signer.sign(challenge.message)};
 h.DB.db.exec("CREATE TRIGGER fail_wallet_audit BEFORE INSERT ON cc_wallet_audit BEGIN SELECT RAISE(ABORT,'wallet audit unavailable'); END;");
 await assert.rejects(h.wallets.verify(alice,origin,input),/wallet audit unavailable/);assert.equal((await h.DB.query('SELECT consumed_at FROM cc_wallet_challenges WHERE id=$1',[challenge.id]))[0].consumed_at,null);assert.equal((await h.wallets.list(alice)).length,0);assert.equal((await h.DB.query('SELECT id FROM cc_wallet_proofs')).length,0);
 h.DB.db.exec('DROP TRIGGER fail_wallet_audit');const results=await Promise.allSettled([h.wallets.verify(alice,origin,input),h.wallets.verify(alice,origin,input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.DB.query('SELECT id FROM cc_wallet_proofs')).length,1);
});
test('removal invalidates outstanding proofs and re-verification restores the same wallet without erasing history',async t=>{
 const h=harness(t),first=await verify(h),pending=await h.wallets.challenge(alice,origin,{chain:'ETH',address:first.signer.address}),signature=await first.signer.sign(pending.message);
 await reject(h.wallets.remove(bob,{walletId:first.wallet.id,revision:0}),403);await reject(h.wallets.remove(alice,{walletId:first.wallet.id,revision:1}),409);
 await h.wallets.remove(alice,{walletId:first.wallet.id,revision:0});assert.equal((await h.wallets.list(alice)).length,0);await reject(h.wallets.verify(alice,origin,{challengeId:pending.id,signature}),409);
 const second=await verify(h,alice,'ETH',first.signer);assert.equal(second.wallet.id,first.wallet.id);assert.equal(second.wallet.revision,2);assert.equal((await h.DB.query('SELECT id FROM cc_wallet_proofs')).length,2);
});
test('disabling an account invalidates pending challenges and never grants wallet access to staff',async t=>{
 const h=harness(t);await h.platform.read(root);const signer=testSigner(),challenge=await h.wallets.challenge(alice,origin,{chain:'ETH',address:signer.address}),signature=await signer.sign(challenge.message);
 await h.platform.execute(root,{type:'platform-remove-account',accountId:alice.accountId,revision:0,note:'Synthetic account disabling.'});await reject(h.wallets.verify(alice,origin,{challengeId:challenge.id,signature}),403);
 await h.platform.execute(root,{type:'platform-restore-account',accountId:alice.accountId,revision:1,note:'Synthetic account restoration.'});await reject(h.wallets.verify(alice,origin,{challengeId:challenge.id,signature}),409);
 const good=await verify(h);assert.equal((await h.wallets.list(root)).length,0);await reject(h.wallets.remove(root,{walletId:good.wallet.id,revision:good.wallet.revision}),403);
});
test('campaigns accept only the owner’s verified wallet and reject stale or raw-address bindings',async t=>{
 const h=harness(t),own=await verify(h),foreign=await verify(h,bob),context=await campaign(h);
 await reject(h.platform.execute(alice,{type:'wallet',...context,chain:'ETH',wallet:own.wallet.address}),422);
 await reject(h.platform.execute(alice,{type:'wallet',...context,walletId:foreign.wallet.id,walletRevision:0}),403);
 await reject(h.platform.execute(alice,{type:'wallet',...context,walletId:own.wallet.id,walletRevision:1}),409);
 await h.platform.execute(alice,{type:'wallet',...context,walletId:own.wallet.id,walletRevision:0,chain:'BNB',wallet:foreign.wallet.address});
 const holder=(await h.platform.read(alice,{view:'shareholder'})).state.holders[0];assert.equal(holder.chain,'ETH');assert.equal(holder.wallet,own.wallet.address);assert.equal(holder.walletVerified,true);assert.equal(holder.walletVerification.walletId,own.wallet.id);
 await h.wallets.remove(alice,{walletId:own.wallet.id,revision:0});assert.equal((await h.platform.read(alice,{view:'shareholder'})).state.holders[0].walletVerified,false);
});
test('verified receiving wallets keep one cross-chain allocation and cannot change after a claim',async t=>{
 const h=harness(t),own=await verify(h),sol=await verify(h,alice,'SOL'),context=await campaign(h);
 await h.platform.execute(alice,{type:'wallet',...context,walletId:own.wallet.id,walletRevision:0});
 await h.platform.execute(root,{type:'fund',...context,company:context.organizationId,chain:'ETH',amount:1000});await h.platform.execute(root,{type:'snapshot',...context});
 await h.platform.execute(alice,{type:'claim',...context});await reject(h.platform.execute(alice,{type:'wallet',...context,walletId:sol.wallet.id,walletRevision:0}),422);
 await h.platform.execute(root,{type:'release',...context,percent:100});await h.wallets.remove(alice,{walletId:own.wallet.id,revision:0});await reject(h.platform.execute(alice,{type:'claim',...context}),409);
 const reverified=await verify(h,alice,'ETH',own.signer);assert.equal(reverified.wallet.id,own.wallet.id);await h.platform.execute(alice,{type:'claim',...context});
 const state=(await h.platform.read(alice,{view:'shareholder'})).state;assert.equal(state.holders[0].allocation,100);assert.equal(state.holders[0].claimed,100);assert.equal(state.holders[0].wallet,own.wallet.address);assert.equal(state.transactions.length,2);assert.ok(state.transactions.every(t=>t.status==='simulated'));
});
test('HTTP wallet API requires verified email/session, same-origin JSON and bounded payloads',async t=>{
 const h=harness(t),service=createWalletHandler({identity:async()=>alice,database:async()=>h.DB,platformOptions:h.options}),request=input=>new Request(origin+'/api/wallets',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 const signer=testSigner();const challengeResponse=await service(request({action:'challenge',chain:'ETH',address:signer.address}));assert.equal(challengeResponse.headers.get('Cache-Control'),'no-store');const {challenge}=await challengeResponse.json();const verified=await service(request({action:'verify',challengeId:challenge.id,signature:await signer.sign(challenge.message)}));assert.equal(verified.status,200);
 const cross=new Request(origin+'/api/wallets',{method:'POST',headers:{Origin:'https://other.example.test','Content-Type':'application/json'},body:'{}'});await reject(service(cross),403);
 await reject(service(request({action:'challenge',chain:'ETH',address:signer.address,padding:'x'.repeat(5000)})),413);
 for(const person of [{...alice,user:{...alice.user,emailVerified:false}},{...alice,sessionHash:null}])await reject(createWalletHandler({identity:async()=>person,database:async()=>h.DB})(new Request(origin+'/api/wallets')),person.sessionHash?403:401);
});
test('cloud wallet nonce is bound to the authenticated provider session, not caller-supplied identities',async t=>{
 const h=harness(t),cookieA=NEON_AUTH_SESSION_COOKIE_NAME+'=test-session-one',cookieB=NEON_AUTH_SESSION_COOKIE_NAME+'=test-session-two',signer=testSigner();
 const handler=createVercelWalletHandler({database:async()=>h.DB,environment:()=>({DATABASE_URL:'test'}),authenticate:async r=>({user:r.headers.has('Cookie')?alice.user:null,issuer,headers:new Headers()})});
 const req=(cookie,input)=>new Request(origin+'/api/wallets',{method:input?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':bob.accountId},...(input?{body:JSON.stringify(input)}:{})});
 assert.equal((await handler(req(null))).status,401);const response=await handler(req(cookieA,{action:'challenge',chain:'ETH',address:signer.address})),{challenge}=await response.json();assert.equal(response.status,200);
 const input={action:'verify',challengeId:challenge.id,signature:await signer.sign(challenge.message)};assert.equal((await handler(req(cookieB,input))).status,409);assert.equal((await handler(req(cookieA,input))).status,200);
 const rows=await h.DB.query('SELECT account_id,session_hash FROM cc_wallet_challenges');assert.equal(rows[0].account_id,alice.accountId);assert.equal(rows[0].session_hash.includes('test-session-one'),false);
 const listed=await (await handler(req(cookieB))).json();assert.equal(listed.wallets.length,1);assert.ok(!JSON.stringify(listed).includes(input.signature));
});

test('provider session identity survives cookie refresh without allowing another session to reuse its challenge',async t=>{
 const h=harness(t),signer=testSigner(),cookie=token=>NEON_AUTH_SESSION_COOKIE_NAME+'='+token;
 const handler=createVercelWalletHandler({database:async()=>h.DB,environment:()=>({DATABASE_URL:'test'}),authenticate:async r=>({user:alice.user,issuer,sessionId:r.headers.get('Cookie')?.includes('other-device')?'other-session':'same-provider-session',headers:new Headers()})});
 const request=(token,input)=>new Request(origin+'/api/wallets',{method:'POST',headers:{Cookie:cookie(token),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 const {challenge}=await(await handler(request('before-refresh',{action:'challenge',chain:'ETH',address:signer.address}))).json(),input={action:'verify',challengeId:challenge.id,signature:await signer.sign(challenge.message)};
 assert.equal((await handler(request('other-device',input))).status,409);assert.equal((await handler(request('after-refresh',input))).status,200);
});
