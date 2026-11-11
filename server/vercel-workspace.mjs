import {createHash} from 'node:crypto';
import {createPlatform,PlatformError} from './platform.mjs';
import {getCloudDatabase} from './neon-database.mjs';
import {authenticateAccount,AuthUnavailableError,publicUser,sameOrigin} from './auth.mjs';
import {DEFAULT_AUTH_BASE_URL} from './auth-config.mjs';
import {createHoldingEvidenceHandler} from './holding-evidence.mjs';
import {createDocumentHandler} from './company-documents.mjs';

const legacyCookieName='__Host-cc-session';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const runtime={environment:'Vercel cloud',storage:'Cloud database',identity:'Company memberships & personal shareholder account'};
export const governanceOptions=env=>({bootstrapOwner:env.PLATFORM_BOOTSTRAP_OWNER_EMAIL?{email:env.PLATFORM_BOOTSTRAP_OWNER_EMAIL,issuer:(env.NEON_AUTH_BASE_URL||DEFAULT_AUTH_BASE_URL).replace(/\/$/,'')}:undefined});
export const accountWorkspaceId=(issuer,id)=>'account:'+createHash('sha256').update(issuer+'\0'+id).digest('hex');
export function legacyWorkspaceId(cookieHeader='') {
  const cookies=cookieHeader.split(';').map(part=>part.trim()).filter(part=>part.startsWith(legacyCookieName+'='));
  const token=cookies.length===1?cookies[0].slice(legacyCookieName.length+1):'';
  return /^[A-Za-z0-9_-]{43}$/.test(token)?'session:'+createHash('sha256').update(token).digest('hex'):null;
}
export function createVercelWorkspaceHandler({database=getCloudDatabase,environment=()=>process.env,authenticate=authenticateAccount}={}) {
  return async function handle(request) {
    const url=new URL(request.url);
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
    if(request.method==='POST'&&!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
    try {
      const identity=await authenticate(request);
      if(!identity.user)return json({error:'Sign in to access your workspace.',signIn:true},401);
      if(identity.user.emailVerified!==true)return json({error:'Verify your email to access your workspace.',signIn:true},403);
      const connectionString=environment().DATABASE_URL||environment().POSTGRES_URL;
      if(!connectionString)return json({error:'Cloud workspace is not configured.',code:'DATABASE_NOT_CONFIGURED'},503);
      const DB=await database(connectionString);
      const id=accountWorkspaceId(identity.issuer,identity.user.id);
      const outputHeaders=new Headers(identity.headers);
      const legacyId=legacyWorkspaceId(request.headers.get('Cookie')||'');
      // Move an owned browser demo only if this account has no saved workspace.
      // The atomic row move preserves its revision and cannot be claimed twice.
      if(request.method==='GET'&&legacyId) {
        const initialized=await DB.query('SELECT id FROM cc_accounts WHERE id=$1',[id]);
        if(!initialized.length&&await DB.adoptWorkspace(legacyId,id))outputHeaders.append('Set-Cookie',`${legacyCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      }
      const platform=createPlatform(DB,governanceOptions(environment()));
      const actor={...identity,accountId:id};
      let selection={view:url.searchParams.get('view')||undefined,organizationId:url.searchParams.get('organization')||undefined,page:url.searchParams.get('page'),search:url.searchParams.get('search'),accountFilter:url.searchParams.get('accounts')};
      if(request.method==='POST') {
        let command;
        try {const text=await request.text();if(Buffer.byteLength(text)>12000)return json({error:'Request too large'},413);command=JSON.parse(text);}
        catch{return json({error:'Invalid request'},400);}
        selection=await platform.execute(actor,command);
      }
      const data=await platform.read(actor,selection);
      outputHeaders.set('Cache-Control','no-store');outputHeaders.set('X-Content-Type-Options','nosniff');
      return Response.json({...data,runtime,user:publicUser(identity.user)},{headers:outputHeaders});
    }catch(error) {
      if(error instanceof PlatformError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);
      if(error instanceof AuthUnavailableError)return json({error:error.message},503);
      console.error('Account workspace request failed');
      return json({error:'Workspace unavailable. Please try again shortly.'},503);
    }
  };
}
export function createVercelDocumentHandler({database=getCloudDatabase,environment=()=>process.env,authenticate=authenticateAccount,handlerFactory=createDocumentHandler}={}){
  return async request=>{
    try{
      if(request.method==='POST'&&!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
      const auth=await authenticate(request);
      if(!auth.user)return json({error:'Sign in to access documents.',signIn:true},401);
      if(auth.user.emailVerified!==true)return json({error:'Verify your email first.',signIn:true},403);
      const connection=environment().DATABASE_URL||environment().POSTGRES_URL;
      if(!connection)return json({error:'Cloud workspace is not configured.'},503);
      const handler=handlerFactory({identity:async()=>({...auth,accountId:accountWorkspaceId(auth.issuer,auth.user.id)}),database:()=>database(connection),platformOptions:governanceOptions(environment())});
      const response=await handler(request);for(const cookie of auth.headers.getSetCookie())response.headers.append('Set-Cookie',cookie);return response;
    }catch(error){if(error instanceof PlatformError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);return json({error:'Document unavailable. Please try again shortly.'},503);}
  };
}

export const createVercelHoldingEvidenceHandler=(options={})=>createVercelDocumentHandler({...options,handlerFactory:createHoldingEvidenceHandler});
