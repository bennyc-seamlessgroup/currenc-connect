import {getWallets} from '@wallet-standard/app';
const hex=bytes=>'0x'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function createWalletRuntime({browser=globalThis.window,registry=getWallets()}={}){
 const providers=new Map();let index=0;
 function add(provider,name){if(!provider||typeof provider.request!=='function'||[...providers.values()].some(v=>v.provider===provider))return;providers.set('evm-'+(++index),{provider,name:typeof name==='string'?name.slice(0,60):'Browser wallet'});}
 browser?.addEventListener('eip6963:announceProvider',event=>{try{add(event.detail?.provider,event.detail?.info?.name);}catch{}});
 function discover(chain){
  if(chain!=='SOL'){
   browser?.dispatchEvent(new Event('eip6963:requestProvider'));
   const injected=browser?.ethereum;
   for(const provider of (Array.isArray(injected?.providers)?injected.providers:injected?[injected]:[]))add(provider,provider.isPhantom?'Phantom':provider.isMetaMask?'MetaMask':provider.isCoinbaseWallet?'Coinbase Wallet':'Browser wallet');
   return [...providers.entries()].map(([id,w])=>({id,name:w.name}));
  }
  const wallets=registry.get().filter(w=>w.features?.['standard:connect']&&w.features?.['solana:signMessage']);
  const list=wallets.map((wallet,i)=>({id:'standard-'+i,name:wallet.name.slice(0,60),wallet}));
  const fallback=[['phantom',browser?.phantom?.solana],['solflare',browser?.solflare]];
  if(!fallback[0][1]&&browser?.solana)fallback[0][1]=browser.solana;
  for(const [name,provider] of fallback)if(provider?.connect&&provider?.signMessage&&!wallets.some(w=>w.name.toLowerCase().includes(name)))list.push({id:'sol-'+name,name:name==='phantom'?'Phantom':'Solflare',provider});
  return list;
 }
 async function connect(id,chain,options={}){
  let invalid=false,closed=false;const cleanups=[];
  const changed=()=>{invalid=true;};
  const release=()=>{closed=true;for(const cleanup of cleanups)try{cleanup();}catch{}};
  const assertOpen=()=>{if(invalid||closed)throw Error('The wallet account or network changed. Connect again.');};
  if(chain==='SOL'){
   const choice=discover(chain).find(w=>w.id===id);if(!choice)throw Error('This wallet is no longer available.');
   if(choice.wallet){
    const w=choice.wallet,result=await w.features['standard:connect'].connect(),account=result.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signMessage'));
    if(!account)throw Error('Choose a Solana account that supports message signing.');
    if(w.features['standard:events'])cleanups.push(w.features['standard:events'].on('change',props=>{if(props.accounts)changed();}));
    const assertActive=async()=>{assertOpen();if(!w.accounts.some(a=>a.address===account.address))throw Error('The wallet account changed. Connect again.');};
    return {address:account.address,chain,release,assertActive,async sign(message){await assertActive();const bytes=new TextEncoder().encode(message),[signed]=await w.features['solana:signMessage'].signMessage({account,message:bytes});if(!signed||!equal(signed.signedMessage,bytes)||signed.signature.length!==64)throw Error('The wallet returned a different message. Connect again.');await assertActive();return hex(signed.signature);}};
   }
   const p=choice.provider,result=await p.connect(),address=(result?.publicKey||p.publicKey)?.toString();
   if(!address)throw Error('The wallet did not return an address.');
   if(p.on){for(const name of ['accountChanged','disconnect']){p.on(name,changed);cleanups.push(()=>p.removeListener?.(name,changed));}}
   const assertActive=async()=>{assertOpen();if(p.publicKey?.toString()!==address)throw Error('The wallet account changed. Connect again.');};
   return {address,chain,release,assertActive,async sign(message){await assertActive();const result=await p.signMessage(new TextEncoder().encode(message),'utf8');await assertActive();if(!result.signature||result.signature.length!==64)throw Error('The wallet returned an invalid signature.');return hex(result.signature);}};
  }
  const p=providers.get(id)?.provider;if(!p)throw Error('This wallet is no longer available.');
  const chainId=options.testnet?'0xaa36a7':chain==='BNB'?'0x38':'0x1',accounts=await p.request({method:'eth_requestAccounts'}),address=accounts?.[0];
  if(typeof address!=='string')throw Error('The wallet did not return an address.');
  if(Number(await p.request({method:'eth_chainId'}))!==Number(chainId))await p.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
  if(p.on){for(const [name,handler] of [['accountsChanged',values=>{if(values?.[0]?.toLowerCase()!==address.toLowerCase())changed();}],['chainChanged',value=>{if(Number(value)!==Number(chainId))changed();}],['disconnect',changed]]){p.on(name,handler);cleanups.push(()=>p.removeListener?.(name,handler));}}
  const assertActive=async()=>{assertOpen();const [accounts,current]=await Promise.all([p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})]);assertOpen();if(accounts?.[0]?.toLowerCase()!==address.toLowerCase()||Number(current)!==Number(chainId))throw Error('The wallet account or network changed. Connect again.');};
  try{await assertActive();}catch(error){release();throw error;}
  return {address,chain,release,assertActive,async sign(message){await assertActive();const signature=await p.request({method:'personal_sign',params:[hex(new TextEncoder().encode(message)),address]});await assertActive();return signature;},...(options.testnet?{async sendTestnet(transaction){
   if(transaction.chainId!==11155111||transaction.from?.toLowerCase()!==address.toLowerCase()||transaction.value!=='0x0'||!/^0x[0-9a-f]+$/i.test(transaction.data||'')||transaction.data.length>60000||transaction.to&&!/^0x[0-9a-f]{40}$/i.test(transaction.to))throw Error('Invalid Sepolia transaction.');
   await assertActive();
   const hash=await p.request({method:'eth_sendTransaction',params:[{from:address,chainId,value:'0x0',data:transaction.data,...(transaction.to?{to:transaction.to}:{})}]});
   if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('The wallet did not return a transaction hash. Check your wallet activity before retrying.');
   return hash;
  }}:{})};
 }
 return {discover:chain=>discover(chain).map(({id,name})=>({id,name})),connect,connectTestnet:id=>connect(id,'ETH',{testnet:true})};
}
export const walletRuntime=createWalletRuntime();
