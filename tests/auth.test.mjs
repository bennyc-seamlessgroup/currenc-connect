import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthentication,AuthUnavailableError} from '../server/auth.mjs';
import {NEON_AUTH_SESSION_COOKIE_NAME as tokenName,NEON_AUTH_SESSION_DATA_COOKIE_NAME as cacheName} from '@neondatabase/auth/server';
const origin='https://app.example.test';
const user={id:'user-a',name:'A',email:'a@example.com',emailVerified:true};
const session={userId:user.id,expiresAt:new Date(Date.now()+3600000).toISOString()};
const request=(action,body,headers={})=>new Request(origin+'/api/auth?action='+action,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
function harness() {
  const calls=[];let revoked=false;
  const auth=createAuthentication({environment:()=>({NEON_AUTH_BASE_URL:'https://provider.example.test/auth'}),proxy:async config=>{
    calls.push(config);
    if(config.path==='get-session')return Response.json(revoked?null:{user,session});
    if(config.path==='sign-out'){revoked=true;return Response.json({success:true},{headers:{'Set-Cookie':`${tokenName}=; Path=/; HttpOnly; Secure; Max-Age=0`}});}
    if(config.path==='sign-in/email-otp') {
      const headers=new Headers();headers.append('Set-Cookie',`${tokenName}=provider-token; Path=/; HttpOnly; Secure; SameSite=Lax`);headers.append('Set-Cookie',`${cacheName}=cache-token; Path=/; Secure; HttpOnly`);
      return Response.json({user,token:'must-not-leak',session},{headers});
    }
    return Response.json({success:true});
  }});
  return {...auth,calls};
}
test('auth sends email codes through the managed provider and validates same-origin input',async()=>{
  const h=harness();
  let response=await h.handle(request('send-code',{email:' A@example.com ',type:'forget-password'}));
  assert.equal(response.status,200);
  assert.equal(h.calls[0].path,'email-otp/send-verification-otp');
  assert.deepEqual(await h.calls[0].request.json(),{email:'a@example.com',type:'sign-in'});
  response=await h.handle(request('send-code',{email:'a@example.com'},{Origin:'https://other.test'}));assert.equal(response.status,403);
  response=await h.handle(request('send-code',{email:'invalid'}));assert.equal(response.status,400);
  response=await h.handle(request('admin/list-users',{}));assert.equal(response.status,404);
  assert.equal(h.calls.length,1);
});
test('auth verifies codes without exposing bearer tokens or accepting cached identities',async()=>{
  const h=harness();
  const response=await h.handle(request('verify-code',{email:'a@example.com',code:'123456'},{Cookie:`${cacheName}=forged; ${tokenName}=existing`,'x-neon-auth-middleware':'forged','oai-authenticated-user-id':'forged'}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{success:true});
  assert.equal(response.headers.getSetCookie().length,1);
  assert.match(response.headers.get('Set-Cookie'),/HttpOnly; Secure/);
  assert.equal(h.calls[0].request.headers.get('Cookie'),`${tokenName}=existing`);
  assert.equal(h.calls[0].request.headers.get('oai-authenticated-user-id'),null);
  assert.equal(h.calls[0].request.headers.get('x-neon-auth-middleware'),null);
  assert.equal((await h.handle(request('verify-code',{email:'a@example.com',code:'123'}))).status,400);
});
test('every workspace session is revalidated with the provider; logout revokes it immediately',async()=>{
  const h=harness();
  const signed=request('session',undefined,{Cookie:`${tokenName}=token; ${cacheName}=forged`});
  assert.equal((await h.authenticate(signed)).user.id,user.id);
  assert.equal(new URL(h.calls[0].request.url).searchParams.get('disableCookieCache'),'true');
  assert.equal((await h.handle(request('sign-out',{}))).status,200);
  assert.equal((await h.authenticate(signed)).user,null);
  const anonymous=await h.authenticate(request('session',undefined,{Cookie:`${cacheName}=forged`}));
  assert.equal(anonymous.user,null);
  const signedOutResponse=await h.handle(request('session'));
  assert.equal(signedOutResponse.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await signedOutResponse.json(),{user:null});
});
test('invalid provider sessions and provider failures never create anonymous workspace access',async()=>{
  const req=request('session',undefined,{Cookie:`${tokenName}=token`});
  for(const data of [{user,session:{...session,userId:'other'}},{user,session:{...session,expiresAt:'2000-01-01'}},{}]) {
    const h=createAuthentication({environment:()=>({NEON_AUTH_BASE_URL:'https://provider.test/auth'}),proxy:async()=>Response.json(data)});
    assert.equal((await h.authenticate(req)).user,null);
  }
  const h=createAuthentication({environment:()=>({NEON_AUTH_BASE_URL:'https://provider.test/auth'}),proxy:async()=>Response.json({error:'unavailable'},{status:502})});
  await assert.rejects(()=>h.authenticate(req),AuthUnavailableError);
});
