import {authenticateAccount,AuthUnavailableError,sameOrigin} from './auth.mjs';
import {accountWorkspaceId,governanceOptions} from './vercel-workspace.mjs';
import {getCloudDatabase} from './neon-database.mjs';
import {createManagedAirdropHandler} from './managed-airdrops.mjs';
import {PlatformError} from './errors.mjs';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createVercelManagedAirdropHandler({database=getCloudDatabase,environment=()=>process.env,authenticate=authenticateAccount}={}){
 return async request=>{
  try{
   if(request.method==='POST'&&!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
   const auth=await authenticate(request);
   if(!auth.user)return json({error:'Sign in to manage airdrops.',signIn:true},401);
   if(auth.user.emailVerified!==true)return json({error:'Verify your email first.',signIn:true},403);
   const connection=environment().DATABASE_URL||environment().POSTGRES_URL;if(!connection)return json({error:'Cloud workspace is not configured.'},503);
   const actor={...auth,accountId:accountWorkspaceId(auth.issuer,auth.user.id)};
   const response=await createManagedAirdropHandler({identity:async()=>actor,database:()=>database(connection),platformOptions:governanceOptions(environment())})(request);
   for(const cookie of auth.headers.getSetCookie())response.headers.append('Set-Cookie',cookie);return response;
  }catch(error){
   if(error instanceof PlatformError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);
   if(error instanceof AuthUnavailableError)return json({error:error.message},503);
   if(['23505','40001','40P01'].includes(error.code))return json({error:'The record already exists or changed. Refresh before trying again.'},409);
   console.error('Managed airdrop request failed');return json({error:'Airdrop management is unavailable. Please try again shortly.'},503);
  }
 };
}
