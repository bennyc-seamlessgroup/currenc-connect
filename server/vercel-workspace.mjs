import {createHash} from 'node:crypto';
import {createPlatform,PlatformError} from './platform.mjs';
import {getCloudDatabase} from './neon-database.mjs';
import {authenticateAccount,AuthUnavailableError,publicUser,sameOrigin} from './auth.mjs';

const legacyCookieName='__Host-cc-session';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const runtime={environment:'Vercel sandbox',storage:'Cloud database',identity:'Company memberships & personal shareholder account'};
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
      const platform=createPlatform(DB);
      const actor={...identity,accountId:id};
      let selection={view:url.searchParams.get('view')||undefined,organizationId:url.searchParams.get('organization')||undefined};
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
      if(error instanceof PlatformError)return json({error:error.message},error.status);
      if(error instanceof AuthUnavailableError)return json({error:error.message},503);
      console.error('Account workspace request failed');
      return json({error:'Workspace unavailable. Please try again shortly.'},503);
    }
  };
}
