import {randomUUID} from 'node:crypto';
import {createPublicClient,http,decodeEventLog,getAddress} from 'viem';
import {sepolia} from 'viem/chains';
import {PlatformError,requireValue} from './errors.mjs';
import {walletForBinding,attachWalletControl} from './wallets.mjs';
import {allocationTree,deploymentData,claimData,pauseData,testnetArtifact,TESTNET_CHAIN_ID,tokens} from './testnet-contract.mjs';
const stmt=(sql,values=[])=>({sql,values});
const changed='EXISTS (SELECT 1 FROM changed)';
const active=param=>`NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=${param} AND (status='suspended' OR archived=1))`;
const sameAddress=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const missing=error=>['TransactionNotFoundError','TransactionReceiptNotFoundError'].includes(error?.name)||error?.cause&&missing(error.cause);
export function testnetClient(environment=process.env){
 const endpoint=environment.SEPOLIA_RPC_URL||'https://ethereum-sepolia-rpc.publicnode.com';
 const url=new URL(endpoint);requireValue(url.protocol==='https:','Configure a secure Sepolia RPC endpoint.',503);
 return createPublicClient({chain:sepolia,transport:http(endpoint,{timeout:8000,retryCount:0})});
}
export function createTestnet(DB,platform,{client=testnetClient(),now=()=>new Date()}={}){
 const query=(sql,values=[])=>DB.query(sql,values),one=async(sql,values=[]) => (await query(sql,values))[0];
 const at=()=>now().toISOString();
 const audit=(actor,organization,action,detail)=>stmt(`INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,[randomUUID(),organization,actor.accountId,action,JSON.stringify(detail),at()]);
 async function chain(){requireValue(await client.getChainId()===TESTNET_CHAIN_ID,'The configured RPC is not Ethereum Sepolia.',503);}
 async function context(identity,input,write=false){
  requireValue(identity?.user?.emailVerified===true,'Verify your email first.',403);await platform.ensureAccount(identity);
  requireValue(typeof input.organizationId==='string'&&typeof input.campaignId==='string','Select a company and campaign.');
  const row=await one('SELECT o.*,s.status AS company_status,s.visible,m.role FROM cc_organizations o JOIN cc_company_status s ON s.organization_id=o.id LEFT JOIN cc_memberships m ON m.organization_id=o.id AND m.account_id=$2 WHERE o.id=$1',[input.organizationId,identity.accountId]);
  requireValue(row,'Campaign unavailable.',404);const data=JSON.parse(row.data),campaign=data.campaigns.find(c=>c.id===input.campaignId),holder=data.holders.find(h=>h.campaign===input.campaignId&&h.accountId===identity.accountId),moderation=await one('SELECT visible,paused FROM cc_campaign_controls WHERE organization_id=$1 AND campaign_id=$2',[row.id,input.campaignId]);
  requireValue(campaign?.delivery==='sepolia','This campaign does not use Sepolia.',404);
  requireValue(row.role||holder,'Campaign unavailable.',403);
  if(write){requireValue(row.company_status==='approved'&&moderation?.paused!==1,'Company or portal campaign operations are paused.',403);requireValue(campaign.status==='locked','Lock the snapshot before using Sepolia.');requireValue(at().slice(0,10)<=(campaign.claimDeadline||campaign.deadline),'The claim deadline has passed.');}
  const config=await one('SELECT * FROM cc_testnet_campaigns WHERE campaign_id=$1 AND organization_id=$2',[campaign.id,row.id]);
  return {row,data,campaign,holder,config,admin:['owner','admin'].includes(row.role)};
 }
 const safe=intent=>({id:intent.id,kind:intent.kind,status:intent.status,hash:intent.tx_hash||null,contract:intent.contract_address||intent.to_address||null,blockNumber:intent.block_number||null,createdAt:intent.created_at});
 const descriptor=(intent,ctx)=>({...safe(intent),campaignName:ctx.campaign.name,token:ctx.campaign.token,amount:intent.kind==='claim'?ctx.holder.allocation:ctx.data.holders.filter(h=>h.campaign===ctx.campaign.id&&h.status==='verified').reduce((sum,h)=>sum+h.allocation,0),chainId:TESTNET_CHAIN_ID,from:intent.sender,to:intent.to_address||null,data:intent.payload,value:'0x0'});
 async function pilot(identity,input){
  requireValue(identity?.user?.emailVerified===true,'Verify your email first.',403);await platform.ensureAccount(identity);
  const row=await one("SELECT o.*,m.role,s.status AS company_status FROM cc_organizations o JOIN cc_memberships m ON m.organization_id=o.id AND m.account_id=$2 JOIN cc_company_status s ON s.organization_id=o.id WHERE o.id=$1",[input.organizationId,identity.accountId]);
  requireValue(row&&['owner','admin'].includes(row.role),'Company owner or admin access is required.',403);requireValue(row.company_status==='approved','Activate this company first.',403);
  requireValue(input.testDataConsent===true,'Confirm that this private pilot uses synthetic data.');requireValue(typeof input.name==='string'&&input.name.trim().length>=1&&input.name.trim().length<=70,'Enter a pilot name.');
  const amount=Number(input.amount);requireValue(Number.isInteger(amount)&&amount>=1&&amount<=1000000,'Enter a whole test amount from 1 to 1,000,000.');
  const wallet=await walletForBinding(DB,identity.accountId,input.walletId,input.walletRevision);requireValue(wallet.chain==='ETH','Choose a verified Ethereum wallet.');
  const data=JSON.parse(row.data),id=randomUUID(),holderId=randomUUID(),today=at().slice(0,10),deadline=new Date(now().getTime()+30*86400000).toISOString().slice(0,10),company=JSON.parse(row.company);
  data.campaigns.unshift({id,company:row.id,name:input.name.trim(),description:'Private Sepolia pilot. Synthetic allocations only; no KYC or shareholdings are verified.',token:company.token,status:'locked',mode:'ratio',ratio:1,budget:amount,minimum:1,cap:amount,release:100,chains:['ETH'],snapshotDate:today,deadline,registrationDeadline:today,claimDeadline:deadline,distribution:'claim',delivery:'sepolia',testOnly:true,snapshotAt:at(),revision:0});
  data.holders.push({id:holderId,accountId:identity.accountId,campaign:id,name:'Test participant',shares:amount,status:'verified',allocation:amount,claimed:0,chain:'ETH',wallet:wallet.address,walletVerification:{walletId:wallet.id,proofId:wallet.verification_id,verifiedAt:wallet.verified_at},testOnly:true,source:'Synthetic test allocation · no KYC or holdings check',asOf:today});
  const result=await DB.atomicChange(stmt(`UPDATE cc_organizations SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3 AND ${active('$4')} AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$2 AND account_id=$4 AND role IN ('owner','admin')) AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$2 AND status='approved') AND EXISTS (SELECT 1 FROM cc_verified_wallets WHERE id=$5 AND account_id=$4 AND revision=$6 AND revoked_at IS NULL) RETURNING id`,[JSON.stringify(data),row.id,row.revision,identity.accountId,wallet.id,wallet.revision]),[
   stmt(`INSERT INTO cc_campaign_controls (organization_id,campaign_id,visible,paused,reason,updated_by,updated_at) SELECT $1,$2,0,0,$3,$4,$5 WHERE ${changed} RETURNING campaign_id`,[row.id,id,'Private synthetic Sepolia pilot',identity.accountId,at()]),audit(identity,row.id,'Private Sepolia pilot created',{campaign:id,amount,synthetic:true})
  ]);requireValue(result.length,'The company or wallet changed. Reload and try again.',409);return {campaignId:id,organizationId:row.id};
 }
 function newGuard(ctx,actor){return `EXISTS (SELECT 1 FROM cc_organizations WHERE id=$2 AND revision=${Number(ctx.row.revision)}) AND ${active('$5')} AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$2 AND status='approved') AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$2 AND campaign_id=$3 AND paused=1)`;}
 async function insertIntent(ctx,actor,kind,sender,payload,to=null,holderId=null,extraGuard=''){
  const id=randomUUID(),values=[id,ctx.row.id,ctx.campaign.id,holderId,actor.accountId,kind,sender,payload,to,at()];
  const result=await DB.atomicChange(stmt(`INSERT INTO cc_testnet_intents (id,organization_id,campaign_id,holder_id,account_id,kind,sender,payload,to_address,created_at,updated_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10 WHERE ${newGuard(ctx,actor)}${extraGuard} RETURNING id`,values),[audit(actor,ctx.row.id,'Sepolia transaction prepared',{campaign:ctx.campaign.id,kind})]);
  requireValue(result.length,'Your permissions or campaign changed. Reload and try again.',409);return one('SELECT * FROM cc_testnet_intents WHERE id=$1',[id]);
 }
 async function prepare(identity,input){
  const ctx=await context(identity,input,true);await chain();const {campaign,config}=ctx;
  if(input.kind==='deploy'){
   requireValue(ctx.admin,'Company owner or admin access is required.',403);requireValue(campaign.testOnly===true,'Only private synthetic pilots can be deployed in this release.');
   const wallet=await walletForBinding(DB,identity.accountId,input.walletId,input.walletRevision);requireValue(wallet.chain==='ETH','Choose a verified Ethereum wallet.');
   const existing=config&&await one('SELECT * FROM cc_testnet_intents WHERE id=$1',[config.deployment_id]);
   if(existing){requireValue(existing.account_id===identity.accountId,'The deployment is managed by the administrator who prepared it.',403);requireValue(existing.status!=='reverted','This deployment reverted. Create a new test campaign to retry.');requireValue(sameAddress(existing.sender,wallet.address),'Choose the wallet used to prepare this deployment.');return descriptor(existing,ctx);}
   const eligible=ctx.data.holders.filter(h=>h.campaign===campaign.id&&h.status==='verified'&&h.allocation>0),controlled=await attachWalletControl(DB,eligible);
   requireValue(controlled.length&&controlled.length<=1000&&controlled.every(h=>h.accountId&&h.chain==='ETH'&&h.walletVerified),'Every allocated shareholder needs a verified Ethereum wallet; this pilot supports up to 1,000 recipients.');
   const tree=allocationTree(controlled),payload=await deploymentData(campaign,tree),id=randomUUID();
   const proofIds=[...new Set(controlled.map(h=>h.walletVerification.walletId))];
   const values=[ctx.row.id,ctx.row.revision,identity.accountId,wallet.id,wallet.revision,campaign.id,...proofIds];
   const guards=`${active('$3')} AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$1 AND account_id=$3 AND role IN ('owner','admin')) AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$1 AND status='approved') AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$1 AND campaign_id=$6 AND paused=1) AND EXISTS (SELECT 1 FROM cc_verified_wallets WHERE id=$4 AND account_id=$3 AND revision=$5 AND revoked_at IS NULL) AND (SELECT COUNT(*) FROM cc_verified_wallets WHERE id IN (${proofIds.map((_,i)=>'$'+(7+i)).join(',')}) AND revoked_at IS NULL)=${proofIds.length}`;
   const result=await DB.atomicChange(stmt(`UPDATE cc_organizations SET revision=revision+1 WHERE id=$1 AND revision=$2 AND ${guards} AND NOT EXISTS (SELECT 1 FROM cc_testnet_campaigns WHERE campaign_id=$6) RETURNING id`,values),[
    stmt(`INSERT INTO cc_testnet_campaigns (campaign_id,organization_id,root,total_units,leaves,deployment_id,created_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE ${changed} RETURNING campaign_id`,[campaign.id,ctx.row.id,tree.root,tree.total,JSON.stringify(tree.rows),id,at()]),
    stmt(`INSERT INTO cc_testnet_intents (id,organization_id,campaign_id,account_id,kind,sender,payload,created_at,updated_at) SELECT $1,$2,$3,$4,'deploy',$5,$6,$7,$7 WHERE ${changed} RETURNING id`,[id,ctx.row.id,campaign.id,identity.accountId,wallet.address,payload,at()]),audit(identity,ctx.row.id,'Sepolia deployment prepared',{campaign:campaign.id,root:tree.root,recipients:tree.rows.length})
   ]);requireValue(result.length,'The campaign or wallet changed. Reload before deploying.',409);return descriptor(await one('SELECT * FROM cc_testnet_intents WHERE id=$1',[id]),ctx);
  }
  requireValue(config?.contract_address,'Deploy the test token first.');
  const deployed=await one('SELECT status FROM cc_testnet_intents WHERE id=$1',[config.deployment_id]);requireValue(['included','confirmed'].includes(deployed?.status),'The deployment is not yet included on Sepolia.');
  const {abi}=await testnetArtifact();
  if(input.kind==='claim'){
   const holder=ctx.holder,leaf=JSON.parse(config.leaves).find(r=>r.holderId===holder?.id&&r.accountId===identity.accountId);
   requireValue(holder?.status==='verified'&&leaf&&holder.claimed===0,'No unclaimed allocation is available.',403);
   requireValue((await attachWalletControl(DB,[holder]))[0].walletVerified,'Reverify the receiving wallet before claiming.',403);
   requireValue(!await client.readContract({address:config.contract_address,abi,functionName:'paused'}),'The company paused claims on Sepolia.');
   requireValue(!await client.readContract({address:config.contract_address,abi,functionName:'claimed',args:[BigInt(leaf.index)]}),'This allocation has already been claimed on Sepolia. Refresh its transaction status.');
   const existing=await one("SELECT * FROM cc_testnet_intents WHERE campaign_id=$1 AND holder_id=$2 AND kind='claim' AND status<>'reverted'",[campaign.id,holder.id]);if(existing)return descriptor(existing,ctx);
   const wallet=await walletForBinding(DB,identity.accountId,holder.walletVerification.walletId,(await one('SELECT revision FROM cc_verified_wallets WHERE id=$1',[holder.walletVerification.walletId])).revision);
   requireValue(sameAddress(wallet.address,leaf.address),'The locked receiving wallet does not match.');
   const guard=` AND EXISTS (SELECT 1 FROM cc_verified_wallets WHERE id='${wallet.id}' AND account_id=$5 AND revision=${wallet.revision} AND revoked_at IS NULL)`;
   try{return descriptor(await insertIntent(ctx,identity,'claim',leaf.address,await claimData(leaf),config.contract_address,holder.id,guard),ctx);}catch(error){if(error.code==='23505'||error.code==='ERR_SQLITE_ERROR'&&/UNIQUE/.test(error.message))throw new PlatformError('A claim is already being prepared. Refresh its status.',409);throw error;}
  }
  requireValue(['pause','resume'].includes(input.kind),'Unsupported Sepolia action.');requireValue(ctx.admin,'Company owner or admin access is required.',403);
  const wallet=await walletForBinding(DB,identity.accountId,input.walletId,input.walletRevision),controller=await client.readContract({address:config.contract_address,abi,functionName:'controller'});requireValue(wallet.chain==='ETH'&&sameAddress(wallet.address,controller),'Use the verified Ethereum wallet that deployed this contract.',403);
  const pending=await one("SELECT * FROM cc_testnet_intents WHERE campaign_id=$1 AND account_id=$2 AND kind=$3 AND status IN ('prepared','submitted','included') ORDER BY created_at DESC LIMIT 1",[campaign.id,identity.accountId,input.kind]);
  return descriptor(pending||await insertIntent(ctx,identity,input.kind,wallet.address,await pauseData(input.kind==='pause'),config.contract_address,null,` AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$2 AND account_id=$5 AND role IN ('owner','admin'))`),ctx);
 }
 async function archive(identity,input){
  const ctx=await context(identity,input);requireValue(ctx.admin,'Company owner or admin access is required.',403);const rows=ctx.data.holders.filter(h=>h.campaign===ctx.campaign.id),settled=rows.length&&rows.every(h=>h.claimed>=h.allocation);requireValue(ctx.campaign.testOnly===true&&ctx.campaign.status==='locked'&&(!ctx.config||settled),'Only unused or fully settled pilots can be archived.');
  ctx.campaign.status='archived';ctx.campaign.archivedAt=at();ctx.campaign.revision=(ctx.campaign.revision||0)+1;
  const result=await DB.atomicChange(stmt(`UPDATE cc_organizations SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3 AND ${active('$4')} AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$2 AND account_id=$4 AND role IN ('owner','admin')) AND ${ctx.config?'EXISTS':'NOT EXISTS'} (SELECT 1 FROM cc_testnet_campaigns WHERE campaign_id=$5) RETURNING id`,[JSON.stringify(ctx.data),ctx.row.id,ctx.row.revision,identity.accountId,ctx.campaign.id]),[audit(identity,ctx.row.id,'Sepolia pilot archived',{campaign:ctx.campaign.id})]);
  requireValue(result.length,'The pilot changed. Refresh before archiving.',409);return {archived:true};
 }
 async function ownIntent(identity,input){const ctx=await context(identity,input);const intent=await one('SELECT * FROM cc_testnet_intents WHERE id=$1 AND campaign_id=$2 AND organization_id=$3',[input.intentId,ctx.campaign.id,ctx.row.id]);requireValue(intent&&(intent.account_id===identity.accountId||ctx.row.role),'Transaction unavailable.',403);return {...ctx,intent};}
 async function submit(identity,input){
  const {intent,row}=await ownIntent(identity,input);requireValue(intent.account_id===identity.accountId,'Only the preparing account can submit its transaction.',403);requireValue(/^0x[0-9a-f]{64}$/i.test(input.hash||''),'Enter a valid transaction hash.');
  if(intent.tx_hash){requireValue(intent.tx_hash.toLowerCase()===input.hash.toLowerCase(),'This action is tracking another hash. Speed-up/cancellation replacement recovery is not available in this pilot.',409);return safe(intent);}
  await chain();let tx;try{tx=await client.getTransaction({hash:input.hash});}catch(error){if(missing(error))throw new PlatformError('The transaction is not visible yet. Keep its hash and retry status recovery shortly.',409);throw error;}
  requireValue(Number(tx.chainId)===TESTNET_CHAIN_ID&&sameAddress(tx.from,intent.sender)&&BigInt(tx.value)===0n&&tx.input.toLowerCase()===intent.payload.toLowerCase()&&(intent.to_address?sameAddress(tx.to,intent.to_address):tx.to===null),'The transaction does not match this Sepolia action.',403);
  try{const result=await DB.atomicChange(stmt(`UPDATE cc_testnet_intents SET tx_hash=$1,status='submitted',revision=revision+1,updated_at=$2 WHERE id=$3 AND account_id=$4 AND revision=$5 AND tx_hash IS NULL AND ${active('$4')} RETURNING id`,[input.hash.toLowerCase(),at(),intent.id,identity.accountId,intent.revision]),[audit(identity,row.id,'Sepolia transaction submitted',{intent:intent.id,hash:input.hash.toLowerCase()})]);requireValue(result.length,'This transaction changed. Refresh its status.',409);}catch(error){if(error.code==='23505'||error.code==='ERR_SQLITE_ERROR'&&/UNIQUE/.test(error.message))throw new PlatformError('This transaction is already assigned to another action.',409);throw error;}
  return safe(await one('SELECT * FROM cc_testnet_intents WHERE id=$1',[intent.id]));
 }
 async function reconcile(identity,input){
  const ctx=await ownIntent(identity,input),{intent}=ctx;requireValue(ctx.row.role!=='viewer'||intent.account_id===identity.accountId,'Viewer access is read-only.',403);if(!intent.tx_hash||['confirmed','reverted'].includes(intent.status))return safe(intent);await chain();
  let receipt;try{receipt=await client.getTransactionReceipt({hash:intent.tx_hash});}catch(error){if(missing(error)){
   if(intent.status==='included')await query("UPDATE cc_testnet_intents SET status='submitted',revision=revision+1,updated_at=$1 WHERE id=$2 AND revision=$3",[at(),intent.id,intent.revision]);
   return safe({...intent,status:'submitted'});
  }throw error;}
  const canonical=await client.getBlock({blockNumber:receipt.blockNumber});requireValue(canonical.hash===receipt.blockHash,'The receipt is no longer canonical. Refresh shortly.',409);
  const finalized=await client.getBlock({blockTag:'finalized'}),status=receipt.blockNumber<=finalized.number?(receipt.status==='success'?'confirmed':'reverted'):'included';
  const success=receipt.status==='success',effects=[];
  if(success&&intent.kind==='deploy'){
   requireValue(receipt.contractAddress,'The deployment did not return a contract address.',409);
   effects.push(stmt(`UPDATE cc_testnet_campaigns SET contract_address=$1,deployment_block=$2,revision=revision+1 WHERE campaign_id=$3 AND deployment_id=$4 AND ${changed} RETURNING campaign_id`,[getAddress(receipt.contractAddress),receipt.blockNumber.toString(),ctx.campaign.id,intent.id]));
  }
  if(success&&intent.kind==='claim'){
   const leaf=JSON.parse(ctx.config.leaves).find(r=>r.holderId===intent.holder_id),{abi}=await testnetArtifact();let event;
   for(const log of receipt.logs){if(!sameAddress(log.address,intent.to_address))continue;try{const parsed=decodeEventLog({abi,data:log.data,topics:log.topics});if(parsed.eventName==='RewardClaimed'&&parsed.args.index===BigInt(leaf.index)&&sameAddress(parsed.args.recipient,leaf.address)&&parsed.args.amount===BigInt(leaf.amount))event=parsed;}catch{}}
   requireValue(event,'The receipt does not contain the expected reward event.',409);
   if(status==='confirmed'){
    const holder=ctx.data.holders.find(h=>h.id===intent.holder_id);requireValue(holder&&holder.wallet===leaf.address&&holder.claimed===0&&holder.allocation===tokens(leaf.amount),'The locked allocation changed. Contact the company.',409);
    holder.claimed=tokens(leaf.amount);ctx.data.transactions.unshift({id:'SEP-'+intent.tx_hash,campaign:ctx.campaign.id,holder:holder.id,chain:'ETH',amount:holder.claimed,wallet:leaf.address,at:at(),status:'confirmed',network:'sepolia',transactionHash:intent.tx_hash,contract:intent.to_address,blockNumber:receipt.blockNumber.toString()});
   }
  }
  const values=[status,receipt.contractAddress||intent.to_address,receipt.blockNumber.toString(),receipt.blockHash,at(),intent.id,intent.revision];
  let update=stmt(`UPDATE cc_testnet_intents SET status=$1,contract_address=$2,block_number=$3,block_hash=$4,updated_at=$5,revision=revision+1 WHERE id=$6 AND revision=$7 RETURNING id`,values);
  if(success&&intent.kind==='claim'&&status==='confirmed'){
   // Lock the shared company revision as the primary change. Independent claims
   // and ordinary company edits must never overwrite each other's saved state.
   update=stmt(`UPDATE cc_organizations SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3 AND EXISTS (SELECT 1 FROM cc_testnet_intents WHERE id=$4 AND status<>'confirmed') RETURNING id`,[JSON.stringify(ctx.data),ctx.row.id,ctx.row.revision,intent.id]);
   effects.push(stmt(`UPDATE cc_testnet_intents SET status=$1,contract_address=$2,block_number=$3,block_hash=$4,updated_at=$5,revision=revision+1 WHERE id=$6 AND ${changed} RETURNING id`,values.slice(0,6)));
  }
  const result=await DB.atomicChange(update,[...effects,audit(identity,ctx.row.id,'Sepolia transaction '+status,{intent:intent.id,kind:intent.kind,hash:intent.tx_hash})]);
  requireValue(result.length,'The transaction or workspace changed. Refresh again.',409);return safe(await one('SELECT * FROM cc_testnet_intents WHERE id=$1',[intent.id]));
 }
 async function status(identity,input){
  const ctx=await context(identity,input),{config}=ctx;
  if(!config)return {chainId:TESTNET_CHAIN_ID,deployment:null,contract:null,paused:null,transactions:[]};
  const deployment=await one('SELECT * FROM cc_testnet_intents WHERE id=$1',[config.deployment_id]);
  const transactions=await query(`SELECT * FROM cc_testnet_intents WHERE campaign_id=$1${ctx.row.role?'':' AND account_id=$2'} ORDER BY created_at DESC LIMIT 20`,ctx.row.role?[ctx.campaign.id]:[ctx.campaign.id,identity.accountId]);
  let paused=null;
  if(config.contract_address&&['included','confirmed'].includes(deployment.status)){await chain();paused=await client.readContract({address:config.contract_address,abi:(await testnetArtifact()).abi,functionName:'paused'});}
  return {chainId:TESTNET_CHAIN_ID,deployment:safe(deployment),contract:config.contract_address,controller:deployment.sender,paused,transactions:transactions.map(t=>({...safe(t),own:t.account_id===identity.accountId}))};
 }
 return {pilot,prepare,submit,reconcile,status,archive};
}
export function createTestnetHandler({identity,database,platformOptions={},client}){
 return async request=>{try{
  requireValue(['GET','POST'].includes(request.method),'Method not allowed.',405);
  if(request.method==='POST')requireValue(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Cross-origin requests are not allowed.',403);
  const actor=await identity(request),DB=await database(),{createPlatform}=await import('./platform.mjs'),service=createTestnet(DB,createPlatform(DB,platformOptions),client?{client}:{});
  let input;
  if(request.method==='GET')input=Object.fromEntries(new URL(request.url).searchParams);
  else {
   requireValue((request.headers.get('Content-Type')||'').startsWith('application/json'),'Use a JSON request.');
   const reader=request.body?.getReader();requireValue(reader,'Invalid request.',400);let size=0;const chunks=[];
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new PlatformError('Request too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
   try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new PlatformError('Invalid request.',400);}
  }
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),'Invalid request.');
  const action=request.method==='GET'?'status':input.action;requireValue(['pilot','status','prepare','submit','reconcile','archive'].includes(action),'Unsupported testnet action.');
  return Response.json(await service[action](actor,input),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){if(error instanceof PlatformError)throw error;console.error('Sepolia operation failed',error.name||'Error');throw new PlatformError('Sepolia status is unavailable. Keep any submitted transaction hash and retry shortly.',503);}};
}
