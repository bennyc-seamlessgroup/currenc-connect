import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,requireValue} from './errors.mjs';
export const MAX_COMPANY_DOCUMENT_BYTES=2*1024*1024;
const changed='EXISTS (SELECT 1 FROM changed)';
export function createCompanyDocuments(DB,platform,{now=()=>new Date()}={}){
  const gov=platform.governance;
  async function upload(identity,{organizationId,purpose,revision,filename,mime,bytes}){
    await platform.ensureAccount(identity);await gov.companyAccess(identity,organizationId);
    const current=await gov.status(organizationId);
    requireValue(['draft','needs_info','rejected'].includes(current.status),'Documents are locked while the company application is being reviewed or approved.',409);
    requireValue(Number.isInteger(revision)&&revision===current.revision,'The application changed. Reload before uploading.',409);
    requireValue(['company','authority'].includes(purpose),'Select a document purpose.');
    requireValue(typeof filename==='string'&&filename.length>0&&filename.length<=120&&!/[\\/\x00-\x1f\x7f]/.test(filename),'Choose a valid filename.');
    requireValue(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=MAX_COMPANY_DOCUMENT_BYTES,'Each document must be 2 MB or smaller.',413);
    const buffer=Buffer.from(bytes);
    const valid=mime==='application/pdf'?buffer.subarray(0,5).toString()==='%PDF-':mime==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:false;
    requireValue(valid,'Upload a PDF, PNG or JPEG file with a matching file type.');
    const id=randomUUID(),created=now().toISOString(),hash=createHash('sha256').update(buffer).digest('hex');
    const rows=await DB.atomicChange({sql:`UPDATE cc_company_status SET revision=revision+1 WHERE organization_id=$1 AND revision=$2 AND status IN ('draft','needs_info','rejected') AND ${gov.memberGuard('$1','$3')} AND (SELECT COUNT(*) FROM cc_company_documents WHERE organization_id=$1)<20 RETURNING organization_id`,values:[organizationId,revision,identity.accountId]},[
      {sql:`UPDATE cc_company_documents SET archived=1 WHERE organization_id=$1 AND purpose=$2 AND archived=0 AND id<>$3 AND ${changed} RETURNING id`,values:[organizationId,purpose,id]},
      {sql:`INSERT INTO cc_company_documents (id,organization_id,purpose,filename,mime,size,sha256,content,application_revision,uploaded_by,created_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE ${changed} RETURNING id`,values:[id,organizationId,purpose,filename,mime,buffer.length,hash,buffer.toString('base64'),revision+1,identity.accountId,created]},
      gov.audit(identity.accountId,'Company evidence uploaded','company',organizationId,{document:id,purpose,filename,sha256:hash,size:buffer.length})
    ]);
    requireValue(rows.length,'The application changed or reached its document version limit. Reload and try again.',409);
    return {id,purpose,filename,mime,size:buffer.length,sha256:hash,applicationRevision:revision+1};
  }
  async function download(identity,id){
    await platform.ensureAccount(identity);
    const row=(await DB.query('SELECT * FROM cc_company_documents WHERE id=$1',[id]))[0];requireValue(row,'Document unavailable.',404);
    await gov.companyAccess(identity,row.organization_id,true);
    return {bytes:Buffer.from(row.content,'base64'),mime:row.mime,filename:row.filename};
  }
  return {upload,download};
}
export function createDocumentHandler({identity,database,platformOptions={}}){
  return async request=>{
    const actor=await identity(request),DB=await database();
    const {createPlatform}=await import('./platform.mjs');
    const documents=createCompanyDocuments(DB,createPlatform(DB,platformOptions));
    if(request.method==='GET'){
      const id=new URL(request.url).searchParams.get('id');requireValue(id&&id.length<=100,'Select a document.',400);
      const doc=await documents.download(actor,id);
      return new Response(doc.bytes,{headers:{'Content-Type':doc.mime,'Content-Disposition':`attachment; filename="company-document"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
    if(request.method!=='POST')throw new PlatformError('Method not allowed.',405);
    requireValue(request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Cross-origin requests are not allowed.',403);
    requireValue((request.headers.get('Content-Type')||'').startsWith('multipart/form-data;'),'Upload a document using multipart form data.',400);
    const max=MAX_COMPANY_DOCUMENT_BYTES+65536;
    requireValue(!request.headers.has('Content-Length')||Number(request.headers.get('Content-Length'))<=max,'Upload is too large.',413);
    const chunks=[];let size=0;const reader=request.body?.getReader();requireValue(reader,'Select a document.',400);
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new PlatformError('Upload is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
    let form;try{form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();}catch{throw new PlatformError('Invalid document upload.',400);}
    for(const key of ['file','organizationId','purpose','revision'])requireValue(form.getAll(key).length===1,'Invalid document upload.',400);
    const file=form.get('file');requireValue(file&&typeof file.arrayBuffer==='function','Select a document.',400);
    return Response.json({document:await documents.upload(actor,{organizationId:form.get('organizationId'),purpose:form.get('purpose'),revision:Number(form.get('revision')),filename:file.name,mime:file.type,bytes:new Uint8Array(await file.arrayBuffer())})},{headers:{'Cache-Control':'no-store'}});
  };
}
