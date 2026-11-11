import {randomUUID} from 'node:crypto';
import {PlatformError,requireValue} from './errors.mjs';
import {AIRDROP_NETWORKS,airdropAddress,parseRecipientCsv,manifestHash} from './airdrop-files.mjs';

const stmt=(sql,values=[])=>({sql,values}),changed='EXISTS (SELECT 1 FROM changed)';
const enabled=p=>`NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=${p} AND (status='suspended' OR archived=1))`;
const staff=p=>`EXISTS (SELECT 1 FROM cc_platform_admins WHERE account_id=${p}) AND ${enabled(p)}`;
const member=(org,p,roles)=>`EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=${org} AND account_id=${p} AND role IN (${roles.map(r=>`'${r}'`).join(',')})) AND ${enabled(p)}`;
const managers=['owner','admin','operator'],administrators=['owner','admin'];
const text=(v,label,max=120)=>{requireValue(typeof v==='string'&&v.trim()&&v.trim().length<=max,`Enter ${label} (${max} characters maximum).`);return v.trim();};
function distributionInfo(input){
 const name=text(input.name,'a campaign name',70),purpose=text(input.purpose,'the distribution purpose',400),network=input.network;
 const config=AIRDROP_NETWORKS[network];requireValue(config,'Select a network.');
 const tokenAddress=airdropAddress(input.tokenAddress,network),symbol=text(input.symbol,'a token symbol',12);
 requireValue(/^[A-Za-z0-9.-]+$/.test(symbol),'Use letters, numbers, dots or hyphens for the token symbol.');
 const decimals=Number(input.decimals);requireValue(Number.isInteger(decimals)&&decimals>=0&&decimals<=config.decimals,'Check the token decimal places.');
 const scheduledAt=text(input.scheduledAt,'a requested release time',24);
 requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:00)?Z$/.test(scheduledAt)&&Number.isFinite(Date.parse(scheduledAt))&&new Date(scheduledAt).toISOString().slice(0,16)===scheduledAt.slice(0,16),'Enter a valid UTC release time.');
 return {name,purpose,network,tokenAddress,symbol,decimals,scheduledAt};
}
const summaryData=({recipients,...data})=>({...data,recipientCount:recipients.length});
function summary(row){const data=row.summary?JSON.parse(row.summary):summaryData(JSON.parse(row.data));return {id:row.id,organizationId:row.organization_id,company:row.company?JSON.parse(row.company).name:undefined,status:row.status,revision:row.revision,version:row.version,manifestHash:row.manifest_hash,reviewNote:row.review_note,createdAt:row.created_at,updatedAt:row.updated_at,...data};}
export async function readManagedOverview(DB,organizationId=null){
 const scoped=organizationId!==null,where=scoped?'WHERE j.organization_id=$1':'',values=scoped?[organizationId]:[];
 const rows=await DB.query(`SELECT j.id,j.organization_id,j.status,j.summary,j.revision,j.version,j.manifest_hash,j.review_note,j.created_at,j.updated_at,o.company FROM cc_managed_airdrops j JOIN cc_organizations o ON o.id=j.organization_id ${where} ORDER BY j.created_at DESC,j.id LIMIT 201`,values);
 const wallets=await DB.query(scoped?'SELECT DISTINCT w.id,w.label,w.network,w.address,w.provider,w.revision FROM cc_custody_wallets w JOIN cc_custody_assets a ON a.wallet_id=w.id WHERE a.organization_id=$1':'SELECT id,label,network,address,provider,revision FROM cc_custody_wallets ORDER BY created_at,id',values);
 const assets=await DB.query(`SELECT a.id,a.organization_id AS "organizationId",a.wallet_id AS "walletId",a.token_address AS "tokenAddress",a.symbol,a.decimals,a.revision,o.company FROM cc_custody_assets a JOIN cc_organizations o ON o.id=a.organization_id ${scoped?'WHERE a.organization_id=$1':''} ORDER BY a.created_at,a.id`,values);
 return {campaigns:rows.slice(0,200).map(summary),more:rows.length>200,wallets,assets:assets.map(({company,...a})=>({...a,company:JSON.parse(company).name,balance:null,reconciledAt:null})),execution:{connected:false,reason:'Custody signing and on-chain reconciliation are not connected. No deposits or releases are enabled.'}};
}
export function createManagedAirdrops(DB,platform,{now=()=>new Date()}={}){
 const query=(sql,values=[])=>DB.query(sql,values),one=async(sql,v)=>(await query(sql,v))[0]||null,at=()=>now().toISOString();
 const audit=(identity,action,type,id,detail)=>platform.governance.audit(identity.accountId,action,type,id,detail);
 const event=(identity,id,action,detail='')=>stmt(`INSERT INTO cc_airdrop_events (id,airdrop_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,[randomUUID(),id,identity.accountId,action,detail,at()]);
 async function context(identity,input,{roles,platformOnly=false,active=false}={}){
  await platform.ensureAccount(identity);const internal=platformOnly||input.view==='platform';if(internal)await platform.governance.requireAdmin(identity);
  const job=input.id?await one('SELECT * FROM cc_managed_airdrops WHERE id=$1',[input.id]):null;
  requireValue(!input.id||job,'Airdrop unavailable.',404);
  const organizationId=job?.organization_id||input.organizationId;
  requireValue(typeof organizationId==='string','Select a company.');
  const org=await one('SELECT o.id,o.company,m.role,s.status FROM cc_organizations o JOIN cc_company_status s ON s.organization_id=o.id LEFT JOIN cc_memberships m ON m.organization_id=o.id AND m.account_id=$2 WHERE o.id=$1',[organizationId,identity.accountId]);
  requireValue(org&&(internal||org.role),'Company access required.',403);
  if(roles)requireValue(internal||roles.includes(org.role),'Your company role does not allow this action.',403);
  if(roles||platformOnly)requireValue(active?org.status==='approved':org.status!=='suspended',active?'The company must be active.':'Company operations are suspended.',403);
  if(job&&roles)requireValue(Number.isInteger(input.revision)&&input.revision===job.revision,'This airdrop changed. Reload before continuing.',409);
  return {job,org,internal};
 }
 function writeGuard(identity,ctx,{platformOnly=false,roles=managers,active=false}={}){
  return `${platformOnly||ctx.internal?staff('$5'):member('$4','$5',roles)} AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$4 AND ${active?"status='approved'":"status<>'suspended'"})`;
 }
 async function update(identity,ctx,next,action,detail='',options={}){
  const {job}=ctx,values=[JSON.stringify(next.data),next.status,job.id,job.organization_id,identity.accountId,job.revision,next.version??job.version,next.hash??null,next.note??job.review_note,at(),JSON.stringify(summaryData(next.data))];
  const effects=[event(identity,job.id,action,detail),audit(identity,action,'managed-airdrop',job.id,{organizationId:job.organization_id,version:next.version??job.version,note:detail})];
  if(next.manifest)effects.push(stmt(`INSERT INTO cc_airdrop_versions (airdrop_id,version,manifest_hash,manifest,submitted_by,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING airdrop_id`,[job.id,next.version,next.hash,JSON.stringify(next.manifest),identity.accountId,at()]));
  const result=await DB.atomicChange(stmt(`UPDATE cc_managed_airdrops SET data=$1,status=$2,revision=revision+1,version=$7,manifest_hash=$8,review_note=$9,updated_at=$10,summary=$11 WHERE id=$3 AND organization_id=$4 AND revision=$6 AND ${writeGuard(identity,ctx,options)} RETURNING id`,values),effects);
  requireValue(result.length,'The airdrop or your access changed. Reload and try again.',409);
 }
 async function create(identity,input){
  const ctx=await context(identity,input,{roles:managers}),data={...distributionInfo(input),recipients:[],totalUnits:'0',total:'0'},id=randomUUID();
  const values=[id,ctx.org.id,JSON.stringify(data),identity.accountId,at(),JSON.stringify(summaryData(data))];
  const guard=ctx.internal?staff('$4'):member('$2','$4',managers);
  const rows=await DB.atomicChange(stmt(`INSERT INTO cc_managed_airdrops (id,organization_id,status,data,created_by,created_at,updated_at,summary) SELECT $1,$2,'draft',$3,$4,$5,$5,$6 WHERE ${guard} AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$2 AND status<>'suspended') RETURNING id`,values),[event(identity,id,'Airdrop draft created'),audit(identity,'Airdrop draft created','managed-airdrop',id,{organizationId:ctx.org.id})]);
  requireValue(rows.length,'Company access changed.',409);return detail(identity,{...input,id});
 }
 async function detail(identity,input){
  const ctx=await context(identity,input),{job}=ctx;requireValue(job,'Select an airdrop.');
  const data=JSON.parse(job.data),page=Math.max(1,Math.min(50,Math.trunc(Number(input.page)||1))),offset=(page-1)*100;
  const events=await query(`SELECT e.action,e.detail,e.created_at,CASE WHEN EXISTS (SELECT 1 FROM cc_internal_accounts ia WHERE ia.account_id=e.actor_id) OR EXISTS (SELECT 1 FROM cc_platform_admins p WHERE p.account_id=e.actor_id) THEN 'Platform team' ELSE 'Company team' END AS actor FROM cc_airdrop_events e WHERE e.airdrop_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 50`,[job.id]);
  return {campaign:{...summary(job),company:JSON.parse(ctx.org.company).name},recipients:data.recipients.slice(offset,offset+100),pagination:{page,more:offset+100<data.recipients.length},events,execution:{connected:false}};
 }
 async function mutate(identity,input){
  const action=input.action,review=['approve','changes'].includes(action),ctx=await context(identity,input,{roles:review?undefined:['submit','cancel','archive'].includes(action)?administrators:managers,platformOnly:review,active:action==='submit'||action==='approve'}),{job}=ctx;
  requireValue(job,'Select an airdrop.');if(review)requireValue(input.revision===job.revision,'This airdrop changed. Reload before reviewing.',409);
  let data=JSON.parse(job.data),next={data,status:job.status,hash:job.manifest_hash};const editable=['draft','changes_requested'].includes(job.status);
  if(action==='update'){
   requireValue(editable,'Submitted airdrops are locked. Request changes before editing.',409);const info=distributionInfo(input);
   requireValue(!data.recipients.length||['network','tokenAddress','decimals'].every(k=>info[k]===data[k]),'Clear the recipient list before changing its network, token address or decimals.');next.data={...data,...info};next.hash=null;
  }else if(action==='import'){
   requireValue(editable,'Submitted recipient lists are locked.',409);
   const parsed=parseRecipientCsv(input.csv,data.network,data.decimals,input.defaultAmount);next.data={...data,...parsed};next.hash=null;
  }else if(action==='clear'){
   requireValue(editable,'Submitted recipient lists are locked.',409);next.data={...data,recipients:[],totalUnits:'0',total:'0'};next.hash=null;
  }else if(action==='submit'){
   requireValue(editable&&data.recipients.length>0,'Import recipients before submitting the distribution.',409);
   requireValue(input.confirm===true,'Confirm the addresses, amounts and distribution instructions.');
   requireValue(Date.parse(data.scheduledAt)>now().getTime(),'Choose a future requested release time.');
   next.status='submitted';next.version=job.version+1;next.note='';next.manifest={organizationId:job.organization_id,airdropId:job.id,version:next.version,...data};next.hash=manifestHash(next.manifest);
  }else if(action==='approve'||action==='changes'){
   requireValue(job.status==='submitted','Only submitted distributions can be reviewed.',409);
   requireValue(job.manifest_hash&&job.version>0,'The submitted manifest is missing.',409);
   const version=await one('SELECT manifest,manifest_hash FROM cc_airdrop_versions WHERE airdrop_id=$1 AND version=$2',[job.id,job.version]);
   requireValue(version&&version.manifest_hash===job.manifest_hash&&manifestHash(JSON.parse(version.manifest))===job.manifest_hash,'The submitted manifest could not be verified.',409);
   next.status=action==='approve'?'approved':'changes_requested';next.note=text(input.note,action==='approve'?'a review note':'the requested changes',600);
  }else if(action==='cancel'){
   requireValue(['draft','submitted','changes_requested','approved'].includes(job.status),'This distribution cannot be cancelled.',409);next.status='cancelled';
  }else if(action==='archive'){
   requireValue(['draft','changes_requested','cancelled'].includes(job.status),'Cancel a submitted or approved distribution before archiving.',409);next.status='archived';
  }else throw new PlatformError('Unsupported airdrop action.');
  const labels={update:'Distribution information updated',import:'Recipient list replaced',clear:'Recipient list cleared',submit:'Distribution submitted',approve:'Distribution plan approved',changes:'Changes requested',cancel:'Distribution cancelled',archive:'Airdrop archived'};
  await update(identity,ctx,next,labels[action],review?next.note:action==='import'?`${next.data.recipients.length} recipient wallets`:'',{platformOnly:review,roles:['submit','cancel','archive'].includes(action)?administrators:managers,active:action==='submit'||action==='approve'});
  return detail(identity,{...input,view:review?'platform':input.view});
 }
 async function walletSave(identity,input){
  await platform.ensureAccount(identity);await platform.governance.requireAdmin(identity);
  const label=text(input.label,'a wallet label',60),network=input.network,address=airdropAddress(input.address,network),provider=input.provider;
  requireValue(['safe','fireblocks','other'].includes(provider),'Select a custody provider.');
  const id=randomUUID();requireValue((await DB.atomicChange(stmt(`INSERT INTO cc_custody_wallets (id,label,network,address,provider,created_by,created_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE ${staff('$6')} RETURNING id`,[id,label,network,address,provider,identity.accountId,at()]),[audit(identity,'Custody wallet configuration saved','custody-wallet',id,{network,provider})])).length,'Your platform access changed.',409);
  return {saved:true};
 }
 async function assetSave(identity,input){
  await platform.ensureAccount(identity);await platform.governance.requireAdmin(identity);
  const wallet=await one('SELECT * FROM cc_custody_wallets WHERE id=$1',[input.walletId]);requireValue(wallet,'Select a custody wallet.');
  const org=await one('SELECT id FROM cc_organizations WHERE id=$1',[input.organizationId]);requireValue(org,'Select a company.');
  const address=airdropAddress(input.tokenAddress,wallet.network),symbol=text(input.symbol,'a token symbol',12),decimals=Number(input.decimals);requireValue(/^[A-Za-z0-9.-]+$/.test(symbol)&&Number.isInteger(decimals)&&decimals>=0&&decimals<=AIRDROP_NETWORKS[wallet.network].decimals,'Check the token symbol and decimals.');
  const id=randomUUID();requireValue((await DB.atomicChange(stmt(`INSERT INTO cc_custody_assets (id,organization_id,wallet_id,token_address,symbol,decimals,created_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE ${staff('$8')} RETURNING id`,[id,org.id,wallet.id,address,symbol,decimals,at(),identity.accountId]),[audit(identity,'Company custody route configured','custody-asset',id,{organizationId:org.id,walletId:wallet.id})])).length,'Your platform access changed.',409);return {saved:true};
 }
 return {create,detail,mutate,walletSave,assetSave};
}
export function createManagedAirdropHandler({identity,database,platformOptions={}}){
 return async request=>{
  requireValue(['GET','POST'].includes(request.method),'Method not allowed.',405);
  if(request.method==='POST')requireValue(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Cross-origin requests are not allowed.',403);
  const actor=await identity(request),DB=await database(),{createPlatform}=await import('./platform.mjs'),service=createManagedAirdrops(DB,createPlatform(DB,platformOptions));let input;
  if(request.method==='GET')input=Object.fromEntries(new URL(request.url).searchParams);
  else{
   requireValue((request.headers.get('Content-Type')||'').startsWith('application/json'),'Use a JSON request.');
   const reader=request.body?.getReader();requireValue(reader,'Invalid request.');let size=0;const chunks=[];
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1200*1024){await reader.cancel();throw new PlatformError('Request too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
   try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new PlatformError('Invalid request.');}
  }
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),'Invalid request.');
  const action=request.method==='GET'?'detail':input.action;let result;
  if(['create','detail','walletSave','assetSave'].includes(action))result=await service[action](actor,input);else result=await service.mutate(actor,input);
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 };
}
