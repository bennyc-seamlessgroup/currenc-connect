import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {verifyMessage} from 'viem';
import {ed25519} from '@noble/curves/ed25519.js';
import {createWalletRuntime} from '../src/wallet-runtime.js';
import {testSigner} from './helpers/wallets.mjs';
function evm(){
 const signer=testSigner(),events=new Map(),requests=[],browser=new EventTarget();let chain='0x1',address=signer.address;
 const provider={isMetaMask:true,on:(name,fn)=>events.set(name,fn),removeListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);},async request(input){requests.push(input);if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return [address];if(input.method==='eth_chainId')return chain;if(input.method==='wallet_switchEthereumChain'){chain=input.params[0].chainId;events.get('chainChanged')?.(chain);return null;}if(input.method==='personal_sign')return signer.sign(Buffer.from(input.params[0].slice(2),'hex').toString('utf8'));throw Error('Unexpected wallet method: '+input.method);}};
 browser.ethereum=provider;browser.addEventListener('eip6963:requestProvider',()=>browser.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{name:'QA EVM'},provider}})));
 return {browser,provider,signer,events,requests,changeAccount(value){address=value;events.get('accountsChanged')?.([value]);},changeChain(value){chain=value;events.get('chainChanged')?.(value);}};
}
test('EIP-6963 discovery deduplicates providers and never connects until requested',async()=>{
 const h=evm(),runtime=createWalletRuntime({browser:h.browser,registry:{get:()=>[]}}),choices=runtime.discover('BNB');assert.equal(choices.length,1);assert.equal(choices[0].name,'QA EVM');assert.equal(h.requests.length,0);
 const connection=await runtime.connect(choices[0].id,'BNB');assert.equal(connection.address,h.signer.address);const message='wallet.example.test\nVerification only\nNonce: real-test-nonce',signature=await connection.sign(message);assert.equal(await verifyMessage({address:connection.address,message,signature}),true);
 assert.ok(h.requests.some(r=>r.method==='wallet_switchEthereumChain'&&r.params[0].chainId==='0x38'));assert.ok(h.requests.every(r=>['eth_requestAccounts','eth_accounts','eth_chainId','wallet_switchEthereumChain','personal_sign'].includes(r.method)));connection.release();assert.equal(h.events.size,0);
});
test('changed EVM accounts or networks invalidate an in-flight proof and never sign a transaction',async()=>{
 for(const kind of ['account','chain']){const h=evm(),runtime=createWalletRuntime({browser:h.browser,registry:{get:()=>[]}}),connection=await runtime.connect(runtime.discover('ETH')[0].id,'ETH');if(kind==='account')h.changeAccount(testSigner().address);else h.changeChain('0x38');await assert.rejects(connection.sign('Verification only'),/changed/);assert.ok(!h.requests.some(r=>r.method==='personal_sign'));connection.release();}
});
test('Solana Wallet Standard signs exactly the requested bytes and rejects altered signed messages',async()=>{
 const signer=testSigner('SOL'),account={address:signer.address,publicKey:bs58.decode(signer.address),chains:['solana:mainnet'],features:['solana:signMessage']};let connected=[],changed=null,alter=false;
 const wallet={name:'QA Solana',get accounts(){return connected;},features:{'standard:connect':{async connect(){connected=[account];return{accounts:connected};}},'standard:events':{on(_name,listener){changed=listener;return()=>{changed=null;};}},'solana:signMessage':{async signMessage({message}){return [{signedMessage:alter?new TextEncoder().encode('changed'):message,signature:Buffer.from((await signer.sign(new TextDecoder().decode(message))).slice(2),'hex')}];}}}};
 const runtime=createWalletRuntime({browser:new EventTarget(),registry:{get:()=>[wallet]}}),connection=await runtime.connect(runtime.discover('SOL')[0].id,'SOL'),message='Verify wallet control only',signature=await connection.sign(message);assert.equal(ed25519.verify(Buffer.from(signature.slice(2),'hex'),Buffer.from(message),bs58.decode(signer.address),{zip215:false}),true);
 alter=true;await assert.rejects(connection.sign(message),/different message/);alter=false;changed({accounts:[]});await assert.rejects(connection.sign(message),/changed/);connection.release();assert.equal(changed,null);
});
test('injected Solana wallets use raw UTF-8 message signing and reject account changes',async()=>{
 const signer=testSigner('SOL'),events=new Map(),browser=new EventTarget(),provider={publicKey:{toString:()=>signer.address},on:(name,fn)=>events.set(name,fn),removeListener:name=>events.delete(name),async connect(){return{publicKey:this.publicKey};},async signMessage(bytes,mode){assert.equal(mode,'utf8');return{signature:Buffer.from((await signer.sign(new TextDecoder().decode(bytes))).slice(2),'hex')};}};browser.phantom={solana:provider};
 const runtime=createWalletRuntime({browser,registry:{get:()=>[]}}),connection=await runtime.connect(runtime.discover('SOL')[0].id,'SOL');assert.equal((await connection.sign('Verify control')).length,130);events.get('accountChanged')?.(null);await assert.rejects(connection.assertActive(),/changed/);connection.release();assert.equal(events.size,0);
});
