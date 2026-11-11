import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,requireValue} from './errors.mjs';
import {registrationEnd} from '../dist/server/domain.mjs';
export const MAX_HOLDING_EVIDENCE_BYTES=2*1024*1024;
const changed='EXISTS (SELECT 1 FROM changed)';
const json=JSON.stringify;
const reviewers=['owner','admin','operator'];
const activeAccount="NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=$4 AND (status='suspended' OR archived=1))";
function date(value){requireValue(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Enter a valid holding date.');return value;}
function shares(value){const n=Number(value);requireValue(Number.isInteger(n)&&n>=1&&n<=10000000,'Enter whole shares between 1 and 10,000,000.');return n;}
function validateFile({filename,mime,bytes}){
  requireValue(typeof filename==='string'&&filename.length>0&&filename.length<=120&&!/[\\/\x00-\x1f\x7f]/.test(filename),'Choose a valid filename.');
  requireValue(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=MAX_HOLDING_EVIDENCE_BYTES,'Each document must be 2 MB or smaller.',413);
  const b=Buffer.from(bytes);
  const valid=mime==='application/pdf'?b.subarray(0,5).toString()==='%PDF-':mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:false;
  requireValue(valid,'Upload a PDF, PNG or JPEG file with a matching file type.');return b;
}
export function createHoldingEvidence(DB,platform,{now=()=>new Date()}={}){
  const one=async(sql,values=[]) => (await DB.query(sql,values))[0];
  async function access(identity,organizationId,holderId){
    requireValue(typeof organizationId==='string'&&organizationId.length>0&&organizationId.length<=200&&(!holderId||(typeof holderId==='string'&&holderId.length<=200)),'Evidence unavailable.',404);
    requireValue(identity?.user?.emailVerified===true,'Verify your email first.',403);
    const account=await platform.ensureAccount(identity);
    const row=await one('SELECT o.*,m.role,s.status AS company_status,s.visible FROM cc_organizations o JOIN cc_company_status s ON s.organization_id=o.id LEFT JOIN cc_memberships m ON m.organization_id=o.id AND m.account_id=$2 WHERE o.id=$1',[organizationId,identity.accountId]);
    requireValue(row,'Evidence unavailable.',404);
    const state=JSON.parse(row.data),holder=state.holders.find(h=>h.id===holderId);
    if(holderId)requireValue(holder&&(holder.accountId===identity.accountId||reviewers.includes(row.role)),'Evidence unavailable.',404);
    return {row,state,holder,account};
  }
  const event=(state,title)=>{state.activity.unshift({id:randomUUID(),at:now().toISOString(),title,detail:'Manual holding evidence workflow',kind:'info'});state.activity=state.activity.slice(0,100);};
  const audit=(identity,org,action,detail)=>({sql:`INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,values:[randomUUID(),org,identity.accountId,action,json(detail),now().toISOString()]});
  async function save(identity,context,next,effects,{review=false,initial=false,campaignId}={}){
    const {row}=context;
    const guard=` AND ${activeAccount} AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$2 AND status='approved'${initial?' AND visible=1':''}) AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$2 AND campaign_id=$5 AND paused=1)${review?" AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$2 AND account_id=$4 AND role IN ('owner','admin','operator'))":''}${initial?" AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$2 AND campaign_id=$5 AND visible=0) AND EXISTS (SELECT 1 FROM cc_portal_settings WHERE id='portal' AND shareholder_registrations=1)":''}`;
    const result=await DB.atomicChange({sql:`UPDATE cc_organizations SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3${guard} RETURNING revision`,values:[json(next),row.id,row.revision,identity.accountId,campaignId]},effects);
    requireValue(result.length,'The submission or access changed. Reload and try again.',409);
  }
  async function upload(identity,input){
    const {organizationId,campaignId}=input;
    const context=await access(identity,organizationId),{row,state,account}=context;
    const c=state.campaigns.find(c=>c.id===campaignId&&c.company===organizationId);
    requireValue(c&&c.status==='open'&&!c.snapshotAt,'This campaign no longer accepts holding evidence.',409);
    requireValue(now().toISOString().slice(0,10)<=registrationEnd(c),'The registration deadline has passed.',409);
    requireValue(row.company_status==='approved','Company operations are unavailable.',403);
    const profile=JSON.parse(account.profile);requireValue(profile.kyc,'Complete the identity step first.',409);
    const old=state.holders.find(h=>h.accountId===identity.accountId&&h.campaign===campaignId),version=old?.evidence?.version||0;
    requireValue(Number.isInteger(input.version)&&input.version===version,'The evidence version changed. Reload before submitting.',409);
    requireValue(!old||(['pending','needs_info','rejected'].includes(old.status)&&(!old.evidence||old.status!=='pending')),'This submission is already under review or approved.',409);
    if(!old){requireValue(row.visible===1,'This company is not accepting registrations.',403);requireValue((await platform.governance.settings()).shareholder_registrations===1,'New shareholder registrations are paused.',403);const control=await one('SELECT visible FROM cc_campaign_controls WHERE organization_id=$1 AND campaign_id=$2',[organizationId,campaignId]);requireValue(control?.visible!==0,'This campaign is not accepting registrations.',403);}
    requireValue(version<10,'This registration has reached its limit of 10 document versions.',409);
    const amount=shares(input.shares),asOf=date(input.asOf);requireValue(asOf<=now().toISOString().slice(0,10),'The holding date cannot be in the future.');requireValue(amount>=c.minimum,`This campaign requires at least ${c.minimum} shares.`);
    const bytes=validateFile(input),id=randomUUID(),holderId=old?.id||randomUUID(),created=now().toISOString(),hash=createHash('sha256').update(bytes).digest('hex');
    const next=structuredClone(state),holder=next.holders.find(h=>h.id===holderId)||{id:holderId,accountId:identity.accountId,campaign:campaignId,name:profile.name,allocation:0,claimed:0};
    Object.assign(holder,{shares:amount,asOf,status:'pending',source:'Holding statement · manual review',evidence:{id,version:version+1}});if(!old)next.holders.push(holder);event(next,'Holding evidence submitted');
    await save(identity,context,next,[{sql:`INSERT INTO cc_holding_evidence (id,organization_id,campaign_id,holder_id,account_id,version,shares,as_of,filename,mime,size,sha256,content,created_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14 WHERE ${changed} RETURNING id`,values:[id,organizationId,campaignId,holderId,identity.accountId,version+1,amount,asOf,input.filename,input.mime,bytes.length,hash,bytes.toString('base64'),created]},audit(identity,organizationId,'Holding evidence submitted',{holderId,campaignId,evidenceId:id,version:version+1})],{initial:!old,campaignId});
    return {holderId,id,version:version+1};
  }
  async function history(identity,organizationId,holderId){
    const {holder}=await access(identity,organizationId,holderId);
    const versions=await DB.query('SELECT e.id,e.version,e.filename,e.mime,e.size,e.shares,e.as_of,e.created_at,r.decision,r.reason,r.shares AS reviewed_shares,r.as_of AS reviewed_as_of,r.created_at AS reviewed_at,a.name AS reviewer FROM cc_holding_evidence e LEFT JOIN cc_holding_reviews r ON r.evidence_id=e.id LEFT JOIN cc_accounts a ON a.id=r.actor_id WHERE e.organization_id=$1 AND e.holder_id=$2 ORDER BY e.version DESC',[organizationId,holderId]);
    return {holderId:holder.id,status:holder.status,versions};
  }
  async function download(identity,id){
    const meta=await one('SELECT organization_id,holder_id FROM cc_holding_evidence WHERE id=$1',[id]);requireValue(meta,'Evidence unavailable.',404);
    await access(identity,meta.organization_id,meta.holder_id);
    const doc=await one('SELECT content,mime,filename FROM cc_holding_evidence WHERE id=$1',[id]);
    return {bytes:Buffer.from(doc.content,'base64'),mime:doc.mime,filename:doc.filename};
  }
  async function review(identity,input){
    const {organizationId,holderId,evidenceId,decision}=input,context=await access(identity,organizationId,holderId),{row,state,holder}=context;
    requireValue(reviewers.includes(row.role),'Your company role cannot review evidence.',403);
    requireValue(holder.accountId!==identity.accountId,'Another company reviewer must review your own submission.',403);
    const c=state.campaigns.find(c=>c.id===holder.campaign);
    requireValue(c?.status==='open'&&!c.snapshotAt,'Eligibility cannot change after the snapshot is locked.',409);
    requireValue(holder.status==='pending'&&holder.evidence?.id===evidenceId,'The submission changed or has already been reviewed.',409);
    requireValue(['approved','needs_info','rejected'].includes(decision),'Select a review outcome.');
    requireValue(typeof input.reason==='string'&&input.reason.trim().length>=5&&input.reason.trim().length<=1000,'Enter a review reason between 5 and 1,000 characters.');
    const amount=decision==='approved'?shares(input.shares):holder.shares,asOf=decision==='approved'?date(input.asOf):holder.asOf;
    if(decision==='approved'){requireValue(asOf<=now().toISOString().slice(0,10),'Approved holdings cannot be dated in the future.');requireValue(input.confirmed===true,'Confirm that you checked the holder name, company, shares and record date.');requireValue(asOf===c.snapshotDate,'Approved holdings must match the campaign record date.');requireValue(amount>=c.minimum,'Approved shares must meet the campaign minimum.');}
    const next=structuredClone(state),h=next.holders.find(h=>h.id===holderId);Object.assign(h,{status:decision==='approved'?'verified':decision,shares:amount,asOf});event(next,'Holding evidence reviewed');
    await save(identity,context,next,[{sql:`INSERT INTO cc_holding_reviews (id,evidence_id,actor_id,decision,reason,shares,as_of,created_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE ${changed} RETURNING id`,values:[randomUUID(),evidenceId,identity.accountId,decision,input.reason.trim(),amount,asOf,now().toISOString()]},audit(identity,organizationId,'Holding evidence '+decision,{holderId,campaignId:c.id,evidenceId,decision,shares:amount,asOf,reason:input.reason.trim()})],{review:true,campaignId:c.id});
    return {holderId,status:h.status};
  }
  return {upload,history,download,review};
}
export function createHoldingEvidenceHandler({identity,database,platformOptions={}}){
  return async request=>{
    const actor=await identity(request),DB=await database();const {createPlatform}=await import('./platform.mjs');
    const evidence=createHoldingEvidence(DB,createPlatform(DB,platformOptions)),url=new URL(request.url);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(request.method==='GET'){
      if(url.searchParams.has('id')){const doc=await evidence.download(actor,url.searchParams.get('id'));return new Response(doc.bytes,{headers:{...headers,'Content-Type':doc.mime,'Content-Disposition':`attachment; filename="holding-evidence"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,'Content-Security-Policy':"sandbox; default-src 'none'"}});}
      requireValue(url.searchParams.get('organization')&&url.searchParams.get('holder'),'Select a submission.',400);
      return Response.json(await evidence.history(actor,url.searchParams.get('organization'),url.searchParams.get('holder')),{headers});
    }
    if(request.method!=='POST')throw new PlatformError('Method not allowed.',405);
    requireValue(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Cross-origin requests are not allowed.',403);
    const type=request.headers.get('Content-Type')||'',max=type.startsWith('application/json')?12000:MAX_HOLDING_EVIDENCE_BYTES+65536;
    requireValue(!request.headers.has('Content-Length')||Number(request.headers.get('Content-Length'))<=max,'Upload is too large.',413);
    const chunks=[];let size=0;const reader=request.body?.getReader();requireValue(reader,'Empty submission.',400);
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new PlatformError('Upload is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
    const body=Buffer.concat(chunks);
    if(type.startsWith('application/json')){let input;try{input=JSON.parse(body.toString());}catch{throw new PlatformError('Invalid review.',400);}requireValue(input&&typeof input==='object','Invalid review.',400);return Response.json(await evidence.review(actor,input),{headers});}
    requireValue(type.startsWith('multipart/form-data;'),'Upload a document using multipart form data.',400);
    let form;try{form=await new Response(body,{headers:{'Content-Type':type}}).formData();}catch{throw new PlatformError('Invalid document upload.',400);}
    for(const key of ['organizationId','campaignId','version','shares','asOf','file'])requireValue(form.getAll(key).length===1,'Invalid document upload.',400);
    const file=form.get('file');requireValue(file&&typeof file.arrayBuffer==='function','Select a document.',400);
    return Response.json(await evidence.upload(actor,{organizationId:form.get('organizationId'),campaignId:form.get('campaignId'),version:Number(form.get('version')),shares:form.get('shares'),asOf:form.get('asOf'),filename:file.name,mime:file.type,bytes:new Uint8Array(await file.arrayBuffer())}),{headers});
  };
}
