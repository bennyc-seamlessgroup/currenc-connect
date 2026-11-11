import test from 'node:test';
import assert from 'node:assert/strict';
import hre from 'hardhat';
import {createPublicClient,createWalletClient,custom,encodeFunctionData} from 'viem';
import {sepolia} from 'viem/chains';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {createWallets} from '../server/wallets.mjs';
import {createTestnet,createTestnetHandler} from '../server/testnet.mjs';
import {createVercelTestnetHandler} from '../server/vercel-testnet.mjs';
import {testnetArtifact,allocationTree,claimData} from '../server/testnet-contract.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
const origin='https://testnet.example.test',issuer='testnet-qa';
const actor=id=>({accountId:'testnet-'+id,issuer,sessionHash:'isolated-testnet-session-'+id,user:{id,name:id,email:id+'@example.test',emailVerified:true}}),root=actor('root'),other=actor('other');
const rejected=(promise,status)=>assert.rejects(promise,e=>e instanceof PlatformError&&e.status===status);
async function harness(t){
 const network=await hre.network.connect({network:'hardhatMainnet'}),provider=network.provider,client=createPublicClient({chain:sepolia,transport:custom(provider)}),wallet=createWalletClient({chain:sepolia,transport:custom(provider)}),accounts=await wallet.getAddresses();
 const DB=createSqliteDatabase(':memory:');t.after(async()=>{DB.close();await network.close();});
 const options={bootstrapOwner:{email:root.user.email,issuer}},platform=createPlatform(DB,options),wallets=createWallets(DB,platform);await platform.read(root);
 const {organizationId}=await platform.execute(root,{type:'platform-create-company',name:'Testnet QA',ticker:'TQA',token:'TEST'});
 const challenge=await wallets.challenge(root,origin,{chain:'ETH',address:accounts[0]}),verified=await wallets.verify(root,origin,{challengeId:challenge.id,signature:await wallet.signMessage({account:accounts[0],message:challenge.message})});
 let finality=false,orphan=false;
 const rpc={...client,async getBlock(input){return client.getBlock(input.blockTag==='finalized'&&!finality?{blockNumber:0n}:input);},async getTransactionReceipt(input){if(orphan)throw Object.assign(Error('Not found'),{name:'TransactionReceiptNotFoundError'});return client.getTransactionReceipt(input);}};
 const service=createTestnet(DB,platform,{client:rpc});
 const pilot=await service.pilot(root,{organizationId,name:'Private wallet pilot',amount:100,walletId:verified.id,walletRevision:0,testDataConsent:true});
 return {DB,platform,wallets,service,client,rpc,wallet,provider,accounts,verified,pilot,options,finalize(){finality=true;},orphan(value){orphan=value;},async send(tx,account=accounts[0]){return wallet.sendTransaction({account,...(tx.to?{to:tx.to}:{}),data:tx.data,value:0n});}};
}
async function deploy(h){const tx=await h.service.prepare(root,{...h.pilot,kind:'deploy',walletId:h.verified.id,walletRevision:0,testDataConsent:true}),hash=await h.send(tx);await h.service.submit(root,{...h.pilot,intentId:tx.id,hash});await h.service.reconcile(root,{...h.pilot,intentId:tx.id});return {tx,hash};}
test('private Sepolia pilot uses synthetic data, retains existing ledgers, and stays private even if listing is forged',async t=>{
 const h=await harness(t),data=await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId});
 assert.equal(data.state.profile.kyc,false);assert.equal(data.state.campaigns[0].delivery,'sepolia');assert.equal(data.state.holders[0].allocation,100);assert.equal(data.state.holders[0].testOnly,true);assert.deepEqual(data.state.treasury[h.pilot.organizationId],{ETH:0,SOL:0,BNB:0});
 await h.DB.query('UPDATE cc_company_status SET visible=1 WHERE organization_id=$1',[h.pilot.organizationId]);await h.DB.query('UPDATE cc_campaign_controls SET visible=1 WHERE campaign_id=$1',[h.pilot.campaignId]);
 assert.equal((await readPublicCampaigns(h.DB)).campaigns.length,0);assert.equal((await h.platform.read(other,{view:'shareholder'})).state.campaigns.length,0);
 await rejected(h.platform.execute(root,{type:'platform-campaign-control',...h.pilot,action:'show',revision:0,note:'Try to expose test data.'}),422);
 for(const command of [{type:'claim'},{type:'distribute'},{type:'release',percent:100},{type:'pause'},{type:'wallet',walletId:h.verified.id,walletRevision:0}])await assert.rejects(h.platform.execute(root,{...command,...h.pilot}));
 await rejected(h.service.pilot(other,{organizationId:h.pilot.organizationId,name:'Bad',amount:100,walletId:h.verified.id,walletRevision:0,testDataConsent:true}),403);
});
test('real local EVM deploy and claim wait for finality, mint once, and never debit simulated treasury',async t=>{
 const h=await harness(t),{tx}=await deploy(h),status=await h.service.status(root,h.pilot);assert.equal(status.deployment.status,'included');assert.ok(status.contract);
 const claim=await h.service.prepare(root,{...h.pilot,kind:'claim'}),hash=await h.send(claim);await h.service.submit(root,{...h.pilot,intentId:claim.id,hash});assert.equal((await h.service.reconcile(root,{...h.pilot,intentId:claim.id})).status,'included');
 let state=(await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state;assert.equal(state.holders[0].claimed,0);assert.equal(state.transactions.length,0);
 const abi=(await testnetArtifact()).abi;assert.equal(await h.client.readContract({address:status.contract,abi,functionName:'balanceOf',args:[h.accounts[0]]}),100000000n);assert.equal(await h.client.readContract({address:status.contract,abi,functionName:'decimals'}),6);
 await assert.rejects(h.send(claim));h.finalize();assert.equal((await h.service.reconcile(root,{...h.pilot,intentId:claim.id})).status,'confirmed');await h.service.reconcile(root,{...h.pilot,intentId:claim.id});
 state=(await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state;assert.equal(state.holders[0].claimed,100);assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].transactionHash,hash.toLowerCase());assert.equal(state.transactions[0].network,'sepolia');assert.equal(state.transactions[0].status,'confirmed');assert.deepEqual(state.treasury[h.pilot.organizationId],{ETH:0,SOL:0,BNB:0});
 await rejected(h.service.prepare(root,{...h.pilot,kind:'claim'}),403);await rejected(h.service.status(other,h.pilot),403);await h.service.archive(root,h.pilot);assert.equal((await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state.campaigns[0].status,'archived');
});
test('transaction submission checks sender, chain, exact calldata, contract and zero native value',async t=>{
 const h=await harness(t),tx=await h.service.prepare(root,{...h.pilot,kind:'deploy',walletId:h.verified.id,walletRevision:0,testDataConsent:true});
 const mismatch=await h.wallet.sendTransaction({account:h.accounts[0],to:h.accounts[1],value:1n});await rejected(h.service.submit(root,{...h.pilot,intentId:tx.id,hash:mismatch}),403);
 const fromOther=await h.send(tx,h.accounts[1]);await rejected(h.service.submit(root,{...h.pilot,intentId:tx.id,hash:fromOther}),403);
 await rejected(h.service.submit(other,{...h.pilot,intentId:tx.id,hash:fromOther}),403);
 const bad=createTestnet(h.DB,h.platform,{client:{...h.rpc,getChainId:async()=>1}});await rejected(bad.prepare(root,{...h.pilot,kind:'deploy',walletId:h.verified.id,walletRevision:0,testDataConsent:true}),503);
 assert.equal((await h.service.status(root,h.pilot)).deployment.hash,null);
});
test('claim receipts are atomic with state/audit, and orphaned included receipts do not settle rewards',async t=>{
 const h=await harness(t);await deploy(h);const tx=await h.service.prepare(root,{...h.pilot,kind:'claim'}),hash=await h.send(tx);await h.service.submit(root,{...h.pilot,intentId:tx.id,hash});await h.service.reconcile(root,{...h.pilot,intentId:tx.id});h.orphan(true);assert.equal((await h.service.reconcile(root,{...h.pilot,intentId:tx.id})).status,'submitted');h.orphan(false);h.finalize();
 h.DB.db.exec("CREATE TRIGGER fail_testnet_audit BEFORE INSERT ON cc_team_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
 await assert.rejects(h.service.reconcile(root,{...h.pilot,intentId:tx.id}),/audit unavailable/);assert.equal((await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state.holders[0].claimed,0);
 h.DB.db.exec('DROP TRIGGER fail_testnet_audit');const result=await Promise.allSettled([h.service.reconcile(root,{...h.pilot,intentId:tx.id}),h.service.reconcile(root,{...h.pilot,intentId:tx.id})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state.transactions.length,1);
});
test('on-chain proof binds recipient and amount, controller alone pauses, and expiry blocks minting',async t=>{
 const h=await harness(t);await deploy(h);const status=await h.service.status(root,h.pilot),{abi}=await testnetArtifact(),config=(await h.DB.query('SELECT leaves FROM cc_testnet_campaigns'))[0],leaf=JSON.parse(config.leaves)[0];
 for(const [account,data] of [[h.accounts[1],await claimData(leaf)],[h.accounts[0],await claimData({...leaf,amount:'200000000'})],[h.accounts[1],encodeFunctionData({abi,functionName:'setPaused',args:[true]})]])await assert.rejects(h.wallet.sendTransaction({account,to:status.contract,data}));
 const pause=await h.service.prepare(root,{...h.pilot,kind:'pause',walletId:h.verified.id,walletRevision:0});await h.send(pause);await rejected(h.service.prepare(root,{...h.pilot,kind:'claim'}),422);
 const resume=await h.service.prepare(root,{...h.pilot,kind:'resume',walletId:h.verified.id,walletRevision:0});await h.send(resume);
 await h.provider.request({method:'evm_increaseTime',params:[31*86400]});await h.provider.request({method:'evm_mine'});await assert.rejects(h.wallet.sendTransaction({account:h.accounts[0],to:status.contract,data:await claimData(leaf)}));
});
test('Merkle proofs handle odd-size trees and distinguish every index, address and amount',async t=>{
 const h=await harness(t),rows=h.accounts.slice(0,5).map((address,i)=>({id:String(i),accountId:'a'+i,status:'verified',wallet:address,allocation:i+1})),tree=allocationTree(rows),{abi,bytecode}=await testnetArtifact(),deadline=BigInt(Math.floor(Date.now()/1000)+86400);
 const hash=await h.wallet.deployContract({account:h.accounts[0],abi,bytecode,args:['Tree Test','TREE',tree.root,deadline,BigInt(tree.total)]}),receipt=await h.client.getTransactionReceipt({hash});
 for(const row of tree.rows){await h.wallet.sendTransaction({account:row.address,to:receipt.contractAddress,data:await claimData(row)});assert.equal(await h.client.readContract({address:receipt.contractAddress,abi,functionName:'claimed',args:[BigInt(row.index)]}),true);}
 assert.equal(await h.client.readContract({address:receipt.contractAddress,abi,functionName:'totalSupply'}),15000000n);
});
test('testnet HTTP rejects forged accounts, cross-origin and oversized requests; wallet proofs stay private',async t=>{
 const h=await harness(t),handler=createTestnetHandler({identity:async()=>root,database:async()=>h.DB,platformOptions:h.options,client:h.rpc}),request=input=>new Request(origin+'/api/testnet',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await handler(request({action:'status',...h.pilot}))).headers.get('Cache-Control'),'no-store');await rejected(handler(new Request(origin+'/api/testnet',{method:'POST',headers:{Origin:'https://other.example.test'},body:'{}'})),403);await rejected(handler(request({padding:'x'.repeat(5000)})),413);
 const cloud=createVercelTestnetHandler({authenticate:async()=>({user:null,issuer,headers:new Headers()}),database:async()=>h.DB,client:h.rpc,environment:()=>({DATABASE_URL:'test'})});assert.equal((await cloud(new Request(origin+'/api/testnet',{headers:{'oai-authenticated-user-id':root.accountId}}))).status,401);
 const status=await h.service.status(root,h.pilot);assert.equal(JSON.stringify(status).includes('proof'),false);
});
test('a transaction hash cannot be reused for a cloned pilot and revoked wallets cannot prepare claims',async t=>{
 const h=await harness(t),{hash}=await deploy(h),clone=await h.service.pilot(root,{organizationId:h.pilot.organizationId,name:'Private wallet pilot',amount:100,walletId:h.verified.id,walletRevision:0,testDataConsent:true}),second=await h.service.prepare(root,{...clone,kind:'deploy',walletId:h.verified.id,walletRevision:0,testDataConsent:true});
 await rejected(h.service.submit(root,{...clone,intentId:second.id,hash}),409);
 await h.wallets.remove(root,{walletId:h.verified.id,revision:0});await rejected(h.service.prepare(root,{...h.pilot,kind:'claim'}),403);
 const before=(await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state;
 await rejected(h.service.pilot(root,{organizationId:h.pilot.organizationId,name:'Revoked',amount:100,walletId:h.verified.id,walletRevision:1,testDataConsent:true}),403);
 assert.equal((await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state.campaigns.length,before.campaigns.length);
});

test('concurrent final claims preserve both rewards and all prior company state',async t=>{
 const h=await harness(t),first={...h.pilot};await deploy(h);const a=await h.service.prepare(root,{...first,kind:'claim'}),hashA=await h.send(a);await h.service.submit(root,{...first,intentId:a.id,hash:hashA});
 h.pilot=await h.service.pilot(root,{organizationId:first.organizationId,name:'Second private pilot',amount:50,walletId:h.verified.id,walletRevision:0,testDataConsent:true});await deploy(h);const b=await h.service.prepare(root,{...h.pilot,kind:'claim'}),hashB=await h.send(b);await h.service.submit(root,{...h.pilot,intentId:b.id,hash:hashB});h.finalize();
 const inputs=[{...first,intentId:a.id},{...h.pilot,intentId:b.id}];await Promise.allSettled(inputs.map(input=>h.service.reconcile(root,input)));for(const input of inputs)await h.service.reconcile(root,input);
 const state=(await h.platform.read(root,{view:'company',organizationId:first.organizationId})).state;assert.equal(state.transactions.length,2);assert.equal(state.holders.reduce((sum,h)=>sum+h.claimed,0),150);assert.equal(state.campaigns.length,2);assert.deepEqual(state.treasury[first.organizationId],{ETH:0,SOL:0,BNB:0});
});
test('an unused pilot can be archived but preparation and archiving cannot both win concurrently',async t=>{
 const h=await harness(t);await h.service.archive(root,h.pilot);let state=(await h.platform.read(root,{view:'company',organizationId:h.pilot.organizationId})).state;assert.equal(state.campaigns[0].status,'archived');assert.equal(state.holders[0].allocation,100);
 const next=await h.service.pilot(root,{organizationId:h.pilot.organizationId,name:'Concurrent pilot',amount:10,walletId:h.verified.id,walletRevision:0,testDataConsent:true});const results=await Promise.allSettled([h.service.archive(root,next),h.service.prepare(root,{...next,kind:'deploy',walletId:h.verified.id,walletRevision:0})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 state=(await h.platform.read(root,{view:'company',organizationId:next.organizationId})).state;const record=state.campaigns.find(c=>c.id===next.campaignId),config=(await h.DB.query('SELECT campaign_id FROM cc_testnet_campaigns WHERE campaign_id=$1',[next.campaignId]))[0];assert.equal(!!config,record.status==='locked');
});
