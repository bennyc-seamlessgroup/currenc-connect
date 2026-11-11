import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {getAddress,verifyMessage} from 'viem';
import {ed25519} from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import {PlatformError,requireValue} from './errors.mjs';
const changed='EXISTS (SELECT 1 FROM changed)';
const active=parameter=>`NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=${parameter} AND (status='suspended' OR archived=1))`;
const statement=(sql,values=[])=>({sql,values});
export const WALLET_CHAINS={ETH:{id:1,name:'Ethereum'},BNB:{id:56,name:'BNB Smart Chain'},SOL:{id:'solana:mainnet',name:'Solana'}};
export function normalizeWallet(chain,input){
 requireValue(typeof chain==='string'&&Object.hasOwn(WALLET_CHAINS,chain),'Select a supported network.');
 requireValue(typeof input==='string'&&input.length<=60,'Enter a valid wallet address.');
 try{
  if(chain==='SOL'){
   const bytes=bs58.decode(input);requireValue(bytes.length===32&&bs58.encode(bytes)===input,'Invalid Solana address.');
   const point=ed25519.Point.fromBytes(bytes,false);requireValue(!point.isSmallOrder()&&point.isTorsionFree(),'Use a signing wallet account, not a program address.');
   return {address:input,key:input};
  }
  const address=getAddress(input);return {address,key:address.toLowerCase()};
 }catch(error){if(error instanceof PlatformError)throw error;throw new PlatformError('Enter a valid signing wallet address.');}
}
const publicWallet=row=>({id:row.id,chain:row.chain,address:row.address,verifiedAt:row.verified_at,revision:row.revision});
export async function readVerifiedWallets(DB,accountId){return (await DB.query('SELECT id,chain,address,verified_at,revision FROM cc_verified_wallets WHERE account_id=$1 AND revoked_at IS NULL ORDER BY verified_at DESC,id',[accountId])).map(publicWallet);}
export async function attachWalletControl(DB,holders){
 const ids=[...new Set(holders.map(h=>h.walletVerification?.walletId).filter(Boolean))];
 let rows=[];
 for(let i=0;i<ids.length;i+=500){const batch=ids.slice(i,i+500);rows.push(...await DB.query(`SELECT id,account_id,chain,address_key,verified_at FROM cc_verified_wallets WHERE id IN (${batch.map((_,i)=>'$'+(i+1)).join(',')}) AND revoked_at IS NULL`,batch));}
 return holders.map(h=>{const row=rows.find(w=>w.id===h.walletVerification?.walletId),key=h.chain==='SOL'?h.wallet:h.wallet?.toLowerCase();return {...h,walletVerified:!!(row&&row.account_id===h.accountId&&row.chain===h.chain&&row.address_key===key)};});
}
export async function walletForBinding(DB,accountId,walletId,revision){
 requireValue(typeof walletId==='string'&&walletId.length<=100&&Number.isInteger(revision),'Connect and verify a wallet before choosing a receiving address.');
 const row=(await DB.query('SELECT * FROM cc_verified_wallets WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL',[walletId,accountId]))[0];
 requireValue(row,'This wallet is not verified for your account.',403);requireValue(row.revision===revision,'The wallet changed. Reload and select it again.',409);return row;
}
export function createWallets(DB,platform,{now=()=>new Date()}={}){
 const one=async(sql,values=[]) => (await DB.query(sql,values))[0];
 async function account(identity){requireValue(identity?.user?.emailVerified===true,'Verify your email first.',403);requireValue(typeof identity.sessionHash==='string'&&identity.sessionHash.length>=16,'Sign in again before verifying a wallet.',401);return platform.ensureAccount(identity);}
 const audit=(identity,action,detail)=>statement(`INSERT INTO cc_wallet_audit (id,account_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5 WHERE ${changed} RETURNING id`,[randomUUID(),identity.accountId,action,JSON.stringify(detail),now().toISOString()]);
 async function challenge(identity,origin,{chain,address}){
  await account(identity);const url=new URL(origin);requireValue(url.origin===origin&&(url.protocol==='https:'||['localhost','127.0.0.1'].includes(url.hostname)),'Use the secure website to connect a wallet.');
  const wallet=normalizeWallet(chain,address),created=now().toISOString(),expires=new Date(now().getTime()+300000).toISOString(),id=randomUUID(),nonce=randomBytes(24).toString('hex');
  const heading=chain==='SOL'?'verify your Solana wallet':'sign in with your Ethereum account';
  const message=`${url.host} wants you to ${heading}:\n${wallet.address}\n\nLink this wallet to your signed-in Currenc Connect account. This does not authorize transactions or token approvals.\n\nURI: ${origin}/\nVersion: 1\nChain ID: ${WALLET_CHAINS[chain].id}\nNonce: ${nonce}\nIssued At: ${created}\nExpiration Time: ${expires}\nRequest ID: ${id}`;
  await DB.query('DELETE FROM cc_wallet_challenges WHERE account_id=$1 AND created_at<$2',[identity.accountId,new Date(now().getTime()-86400000).toISOString()]);
  const result=await DB.query(`INSERT INTO cc_wallet_challenges (id,account_id,session_hash,origin,chain,address,address_key,message,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE ${active('$2')} AND (SELECT COUNT(*) FROM cc_wallet_challenges WHERE account_id=$2 AND created_at>$11)<20 RETURNING id`,[id,identity.accountId,identity.sessionHash,origin,chain,wallet.address,wallet.key,message,created,expires,new Date(now().getTime()-3600000).toISOString()]);
  requireValue(result.length,'Too many verification requests. Please try again later.',429);
  return {id,chain,address:wallet.address,message,expiresAt:expires};
 }
 async function verify(identity,origin,{challengeId,signature}){
  await account(identity);requireValue(typeof challengeId==='string'&&challengeId.length<=100&&typeof signature==='string'&&signature.length<=140,'Invalid wallet verification.');
  const row=await one('SELECT * FROM cc_wallet_challenges WHERE id=$1 AND account_id=$2 AND session_hash=$3 AND origin=$4',[challengeId,identity.accountId,identity.sessionHash,origin]);
  const time=now().toISOString();requireValue(row&&!row.consumed_at&&row.expires_at>time&&row.attempts<5,'This verification expired or was already used. Connect again.',409);
  let valid=false;
  try{
   if(row.chain==='SOL')valid=/^0x[0-9a-f]{128}$/i.test(signature)&&ed25519.verify(Buffer.from(signature.slice(2),'hex'),Buffer.from(row.message,'utf8'),bs58.decode(row.address),{zip215:false});
   else valid=/^0x[0-9a-f]{130}$/i.test(signature)&&await verifyMessage({address:row.address,message:row.message,signature});
  }catch{}
  if(!valid){await DB.query('UPDATE cc_wallet_challenges SET attempts=attempts+1 WHERE id=$1 AND account_id=$2 AND consumed_at IS NULL',[row.id,identity.accountId]);throw new PlatformError('The signature does not match this wallet and verification message.');}
  const walletId='wallet-'+createHash('sha256').update(identity.accountId+'\0'+row.chain+'\0'+row.address_key).digest('hex').slice(0,48),proofId=randomUUID();
  const result=await DB.atomicChange(statement(`UPDATE cc_wallet_challenges SET consumed_at=$1,attempts=attempts+1 WHERE id=$2 AND account_id=$3 AND session_hash=$4 AND origin=$5 AND consumed_at IS NULL AND expires_at>$1 AND attempts<5 AND ${active('$3')} RETURNING id`,[time,row.id,identity.accountId,identity.sessionHash,origin]),[
   statement(`INSERT INTO cc_verified_wallets (id,account_id,chain,address,address_key,verified_at,verification_id,revision) SELECT $1,$2,$3,$4,$5,$6,$7,0 WHERE ${changed} ON CONFLICT (account_id,chain,address_key) DO UPDATE SET verified_at=excluded.verified_at,verification_id=excluded.verification_id,revoked_at=NULL,revision=cc_verified_wallets.revision+1 RETURNING id`,[walletId,identity.accountId,row.chain,row.address,row.address_key,time,proofId]),
   statement(`INSERT INTO cc_wallet_proofs (id,account_id,wallet_id,challenge_id,chain,address,message,signature,created_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE ${changed} RETURNING id`,[proofId,identity.accountId,walletId,row.id,row.chain,row.address,row.message,signature,time]),
   audit(identity,'Wallet control verified',{walletId,chain:row.chain,address:row.address,proofId})
  ]);
  requireValue(result.length,'This verification changed or was already used. Connect again.',409);
  return publicWallet(await one('SELECT * FROM cc_verified_wallets WHERE id=$1',[walletId]));
 }
 async function remove(identity,{walletId,revision}){
  await account(identity);const wallet=await walletForBinding(DB,identity.accountId,walletId,revision);
  const result=await DB.atomicChange(statement(`UPDATE cc_verified_wallets SET revoked_at=$1,revision=revision+1 WHERE id=$2 AND account_id=$3 AND revision=$4 AND revoked_at IS NULL AND ${active('$3')} RETURNING id`,[now().toISOString(),walletId,identity.accountId,revision]),[statement(`UPDATE cc_wallet_challenges SET consumed_at=$1 WHERE account_id=$2 AND chain=$3 AND address_key=$4 AND consumed_at IS NULL AND ${changed} RETURNING id`,[now().toISOString(),identity.accountId,wallet.chain,wallet.address_key]),audit(identity,'Wallet removed',{walletId})]);
  requireValue(result.length,'The wallet changed. Reload and try again.',409);return {removed:true};
 }
 return {challenge,verify,remove,list:async identity=>{await account(identity);return readVerifiedWallets(DB,identity.accountId);}};
}
export function createWalletHandler({identity,database,platformOptions={}}){
 return async request=>{
  requireValue(['GET','POST'].includes(request.method),'Method not allowed.',405);
  const origin=new URL(request.url).origin;
  if(request.method==='POST')requireValue(request.headers.get('Origin')===origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Cross-origin requests are not allowed.',403);
  const actor=await identity(request),DB=await database(),{createPlatform}=await import('./platform.mjs'),wallets=createWallets(DB,createPlatform(DB,platformOptions));
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method==='GET')return Response.json({wallets:await wallets.list(actor)},{headers});
  requireValue((request.headers.get('Content-Type')||'').startsWith('application/json'),'Use a JSON wallet request.',400);
  requireValue(!request.headers.has('Content-Length')||Number(request.headers.get('Content-Length'))<=4096,'Request too large.',413);
  const reader=request.body?.getReader();requireValue(reader,'Invalid wallet request.',400);let total=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>4096){await reader.cancel();throw new PlatformError('Request too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new PlatformError('Invalid wallet request.',400);}
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),'Invalid wallet request.',400);
  if(input.action==='challenge')return Response.json({challenge:await wallets.challenge(actor,origin,input)},{headers});
  if(input.action==='verify')return Response.json({wallet:await wallets.verify(actor,origin,input)},{headers});
  if(input.action==='remove')return Response.json(await wallets.remove(actor,input),{headers});
  throw new PlatformError('Unknown wallet action.',400);
 };
}
