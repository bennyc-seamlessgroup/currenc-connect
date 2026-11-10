import {randomBytes} from 'node:crypto';
import {
  handleAuthProxyRequest, NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_SESSION_DATA_COOKIE_NAME, parseCookieValue,
} from '@neondatabase/auth/server';
import {DEFAULT_AUTH_BASE_URL} from './auth-config.mjs';

// The provider session is authoritative. This SDK-required cache signing key is
// intentionally ephemeral: cached session-data cookies are neither accepted nor
// returned. Every protected API request revalidates with Neon, including logout.
const cacheKey = randomBytes(32).toString('base64url');
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export class AuthUnavailableError extends Error {}
export const sameOrigin = request => request.headers.get('Origin')===new URL(request.url).origin && request.headers.get('Sec-Fetch-Site')!=='cross-site';

export function createAuthentication({environment=()=>process.env,proxy=handleAuthProxyRequest}={}) {
  function baseUrl() {
    const value=environment().NEON_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL;
    if(!value)throw new AuthUnavailableError('Account sign-in is not configured.');
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password)throw new AuthUnavailableError('Invalid sign-in configuration.');
    return url.href.replace(/\/$/,'');
  }
  async function upstream(request,path,payload) {
    const target=new URL('/api/auth/'+path,new URL(request.url).origin);
    if(path==='get-session')target.searchParams.set('disableCookieCache','true');
    const headers=new Headers(request.headers);
    for(const name of [...headers.keys()])if(name.startsWith('x-neon-auth')||name.startsWith('oai-authenticated-'))headers.delete(name);
    const token=parseCookieValue(headers.get('Cookie')||'',NEON_AUTH_SESSION_COOKIE_NAME);
    headers.set('Cookie',token?`${NEON_AUTH_SESSION_COOKIE_NAME}=${token}`:'');
    headers.set('Origin',new URL(request.url).origin);
    headers.set('Content-Type','application/json');
    const internal=new Request(target,{method:payload===undefined?'GET':'POST',headers,...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    const response=await proxy({request:internal,path,baseUrl:baseUrl(),cookieSecret:cacheKey,sameSite:'lax'});
    const outputHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    for(const cookie of response.headers.getSetCookie()) {
      if(!cookie.startsWith(NEON_AUTH_SESSION_DATA_COOKIE_NAME+'='))outputHeaders.append('Set-Cookie',cookie);
    }
    return {response,headers:outputHeaders};
  }
  async function authenticate(request) {
    const issuer=baseUrl();
    if(!parseCookieValue(request.headers.get('Cookie')||'',NEON_AUTH_SESSION_COOKIE_NAME))return {user:null,issuer,headers:new Headers()};
    const {response,headers}=await upstream(request,'get-session');
    if(response.status>=500)throw new AuthUnavailableError('Sign-in service unavailable. Try again shortly.');
    if(!response.ok)return {user:null,issuer,headers};
    const data=await response.json();
    const valid=data?.session && typeof data?.user?.id==='string' && data.user.id.length>0 && typeof data.user.email==='string' && data.session.userId===data.user.id && Number.isFinite(Date.parse(data.session.expiresAt)) && Date.parse(data.session.expiresAt)>Date.now();
    return {user:valid?data.user:null,issuer,headers};
  }
  async function handle(request) {
    const action=new URL(request.url).searchParams.get('action');
    if(request.method==='GET'&&action==='session') {
      try {const result=await authenticate(request);return Response.json({user:result.user?publicUser(result.user):null},{headers:result.headers});}
      catch {return json({error:'Sign-in service unavailable. Try again shortly.'},503);}
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
    const paths={'send-code':'email-otp/send-verification-otp','verify-code':'sign-in/email-otp','sign-out':'sign-out'};
    if(!paths[action])return json({error:'Unknown sign-in action'},404);
    let input;
    try {const text=await request.text();if(Buffer.byteLength(text)>2048)return json({error:'Request too large'},413);input=JSON.parse(text);}
    catch {return json({error:'Invalid request'},400);}
    let payload={};
    if(action!=='sign-out') {
      const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
      if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a valid email address.'},400);
      payload={email,...(action==='send-code'?{type:'sign-in'}:{otp:input?.code})};
      if(action==='verify-code'&&(typeof payload.otp!=='string'||!/^\d{6}$/.test(payload.otp)))return json({error:'Enter the 6-digit verification code.'},400);
    }
    try {
      const {response,headers}=await upstream(request,paths[action],payload);
      // Auth tokens remain in HttpOnly cookies, never in client-side JSON.
      if(response.ok)return Response.json({success:true},{status:200,headers});
      const error=response.status===429?'Too many attempts. Please wait before trying again.':action==='verify-code'?'That code is invalid or has expired. Request a new code.':'Unable to complete sign-in. Please try again.';
      return Response.json({error},{status:response.status>=500?503:response.status,headers});
    }catch{return json({error:'Sign-in service unavailable. Try again shortly.'},503);}
  }
  return {authenticate,handle};
}
export function publicUser(user) {return {name:typeof user.name==='string'?user.name:'',email:user.email,emailVerified:user.emailVerified===true};}
const authentication=createAuthentication();
export const authenticateAccount=authentication.authenticate;
export const handleAuthRequest=authentication.handle;
