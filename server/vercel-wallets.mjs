import {createHash} from 'node:crypto';
import {NEON_AUTH_SESSION_COOKIE_NAME,parseCookieValue} from '@neondatabase/auth/server';
import {authenticateAccount,AuthUnavailableError,sameOrigin} from './auth.mjs';
import {accountWorkspaceId,governanceOptions} from './vercel-workspace.mjs';
import {getCloudDatabase} from './neon-database.mjs';
import {createWalletHandler} from './wallets.mjs';
import {PlatformError} from './errors.mjs';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createVercelWalletHandler({database=getCloudDatabase,environment=()=>process.env,authenticate=authenticateAccount}={}){
 return async request=>{
  try{
   if(request.method==='POST'&&!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
   const auth=await authenticate(request);
   if(!auth.user)return json({error:'Sign in to manage your wallets.',signIn:true},401);
   if(auth.user.emailVerified!==true)return json({error:'Verify your email first.',signIn:true},403);
   const token=parseCookieValue(request.headers.get('Cookie')||'',NEON_AUTH_SESSION_COOKIE_NAME);
   if(!token)return json({error:'Sign in again to verify a wallet.',signIn:true},401);
   const connection=environment().DATABASE_URL||environment().POSTGRES_URL;
   if(!connection)return json({error:'Cloud workspace is not configured.'},503);
   const actor={...auth,accountId:accountWorkspaceId(auth.issuer,auth.user.id),sessionHash:createHash('sha256').update(auth.issuer+'\0'+(typeof auth.sessionId==='string'?'session:'+auth.sessionId:'cookie:'+token)).digest('hex')};
   const response=await createWalletHandler({identity:async()=>actor,database:()=>database(connection),platformOptions:governanceOptions(environment())})(request);
   for(const cookie of auth.headers.getSetCookie())response.headers.append('Set-Cookie',cookie);return response;
  }catch(error){
   if(error instanceof PlatformError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);
   if(['40001','40P01'].includes(error.code))return json({error:'The wallet changed. Reload and try again.'},409);
   if(error instanceof AuthUnavailableError)return json({error:error.message},503);
   console.error('Wallet request failed');return json({error:'Wallet verification is unavailable. Please try again shortly.'},503);
  }
 };
}
