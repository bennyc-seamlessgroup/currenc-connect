let walletWork=0,walletBusy=false,walletPending=null,walletContext=null,walletRuntimePromise=null;
function cancelWalletFlow(){walletWork++;walletBusy=false;walletPending?.connection?.release();walletPending=null;}
const walletRuntimeModule=()=>walletRuntimePromise||(walletRuntimePromise=import('/wallet-runtime.js'));
function walletPanel(){
 return `<section class="panel profile-panel"><div class="panel-title">${icon('wallet')}<h2>Receiving wallets</h2></div>${verifiedWallets.length?verifiedWallets.map(w=>`<div class="verified-wallet-row">${chainIcon(w.chain)}<div><strong>${CHAIN_NAMES[w.chain]}</strong><span class="mono">${esc(short(w.address))}</span></div>${btn('Manage','wallet-details','text-btn',`data-id="${w.id}"`)}</div>`).join(''):'<p class="subtle-empty">Connect a wallet and verify it with a message signature.</p>'}${btn(`${icon('plus')}Connect wallet`,'wallet-start','secondary full')}${state.holders.some(h=>isMine(h)&&h.wallet&&!h.walletVerified)?'<p class="form-hint">Previously saved campaign addresses have not been verified by signature.</p>':''}</section>`;
}
async function walletRequest(input){
 const r=await fetch('/api/wallets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await r.json();
 if(r.status===401||(r.status===403&&data.signIn)){lockWorkspace();render();throw Error('Your session ended. Sign in again.');}
 if(['ACCOUNT_REMOVED','ACCOUNT_SUSPENDED'].includes(data.code)){lockWorkspace();authRequired=false;accountRemoved=true;render();throw Error(data.error);}
 if(!r.ok)throw Error(data.error||'Unable to verify this wallet.');return data;
}
async function walletStart(campaignId=null,chain=null){
 cancelWalletFlow();walletContext={campaignId,chain:chain||state.campaigns.find(c=>c.id===campaignId)?.chains[0]||'ETH'};
 const run=walletWork,c=state.campaigns.find(c=>c.id===campaignId),chains=c?.chains||['ETH','SOL','BNB'];
 openModal('Connect wallet','<p class="modal-description" role="status">Finding available wallets…</p>');
 try{
  const {walletRuntime}=await walletRuntimeModule();if(run!==walletWork||!state)return;
  const choices=walletRuntime.discover(walletContext.chain);
  openModal('Connect wallet',`<p class="modal-description">Sign a message to verify wallet control. No transaction or token approval is requested.</p><label class="field"><span>Network</span><select id="connect-wallet-chain">${chains.map(ch=>`<option value="${ch}" ${ch===walletContext.chain?'selected':''}>${CHAIN_NAMES[ch]}</option>`).join('')}</select></label><div class="wallet-provider-list">${choices.length?choices.map(w=>btn(`${icon('wallet')}<span>${esc(w.name)}</span>${icon('arrow')}`,'wallet-connect','secondary full',`data-provider="${esc(w.id)}"`)).join(''):'<p>No compatible wallet detected.</p><p class="muted">Use a browser wallet extension. On mobile, open this site in your wallet app’s browser.</p>'}</div>${notice(walletContext.chain==='SOL'?'Solana message signing verifies control of your address.':'Standard Ethereum and BNB signing accounts are supported. Smart contract wallet verification is not available yet.')}`);
 }catch(e){if(run===walletWork&&state){closeModal();toast(e.message,true);}}
}
function receivingWallet(c){
 cancelWalletFlow();walletContext={campaignId:c.id,chain:c.chains[0]};
 const choices=verifiedWallets.filter(w=>c.chains.includes(w.chain));
 openModal('Receiving wallet',`<p class="modal-description">${esc(c.name)}</p>${choices.length?`<div class="wallet-selection-list">${choices.map(w=>btn(`${chainIcon(w.chain)}<span><strong>${CHAIN_NAMES[w.chain]}</strong><span class="mono">${esc(w.address)}</span></span>${icon('arrow')}`,'wallet-use','secondary full',`data-id="${w.id}" data-campaign="${c.id}"`)).join('')}</div>`:'<p>No verified wallet is available for this campaign.</p>'}<div class="modal-actions">${btn('Connect a wallet','wallet-start','primary',`data-campaign="${c.id}"`)}</div>`);
}
async function walletAction(action,data){
 if(action==='wallet-start'){await walletStart(data.campaign||null);return true;}
 if(action==='wallet-details'){
  const w=verifiedWallets.find(w=>w.id===data.id);if(w)openModal('Verified wallet',`<div class="modal-status">${chainTags([w.chain])}<span class="badge verified">Control verified</span></div><dl class="detail-list"><div><dt>Network</dt><dd>${CHAIN_NAMES[w.chain]}</dd></div><div><dt>Address</dt><dd class="mono wrap">${esc(w.address)}</dd></div><div><dt>Verified</dt><dd>${esc(time(w.verifiedAt))}</dd></div></dl><div class="modal-actions">${btn('Remove wallet','wallet-remove','danger',`data-id="${w.id}"`)}</div>`);return true;
 }
 if(action==='wallet-remove'){
  const w=verifiedWallets.find(w=>w.id===data.id);if(w)openModal('Remove saved wallet?',`<p class="modal-description">${esc(w.address)}</p>${notice('Campaign records and previous payouts are kept. Reverify this address to use it again, including campaigns whose receiving address is locked after a claim.')}<div class="modal-actions">${btn('Cancel','close','secondary')}${btn('Remove wallet','wallet-remove-confirm','danger',`data-id="${w.id}"`)}</div>`);return true;
 }
 if(action==='wallet-remove-confirm'){
  const w=verifiedWallets.find(w=>w.id===data.id);if(w){try{await walletRequest({action:'remove',walletId:w.id,revision:w.revision});closeModal();await load();toast('Saved wallet removed');}catch(e){toast(e.message,true);}}return true;
 }
 if(action==='wallet-use'){
  const w=verifiedWallets.find(w=>w.id===data.id),c=state.campaigns.find(c=>c.id===data.campaign);
  if(w&&c&&await command({type:'wallet',campaignId:c.id,walletId:w.id,walletRevision:w.revision},'Receiving wallet saved'))join(state.campaigns.find(row=>row.id===c.id),true);return true;
 }
 if(action==='wallet-connect'){
  if(walletBusy)return true;walletBusy=true;const run=walletWork,context={...walletContext};let connection;
  openModal('Connect wallet','<p class="modal-description" role="status">Approve the connection in your wallet.</p>');
  try{
   const {walletRuntime}=await walletRuntimeModule();connection=await walletRuntime.connect(data.provider,context.chain);
   if(run!==walletWork||!state){connection.release();return true;}
   const {challenge}=await walletRequest({action:'challenge',chain:context.chain,address:connection.address});await connection.assertActive();
   if(run!==walletWork||!state){connection.release();return true;}
   walletPending={connection,challenge,context};
   openModal('Verify wallet control',`<div class="modal-status">${chainTags([context.chain])}<strong>${CHAIN_NAMES[context.chain]}</strong></div><p class="wallet-full-address mono">${esc(challenge.address)}</p><p>Sign the verification message in your wallet to save this address.</p><details class="wallet-message"><summary>Verification message</summary><pre>${esc(challenge.message)}</pre></details><div class="modal-actions">${btn('Back','wallet-back','secondary')}${btn('Sign message','wallet-sign','primary')}</div>`);
  }catch(e){connection?.release();if(run===walletWork&&state){await walletStart(context.campaignId,context.chain);toast(walletError(e),true);}}finally{if(run===walletWork)walletBusy=false;}return true;
 }
 if(action==='wallet-back'){const context=walletContext;await walletStart(context.campaignId,context.chain);return true;}
 if(action==='wallet-sign'){
  if(walletBusy||!walletPending)return true;walletBusy=true;const run=walletWork,pending=walletPending;
  try{
   const signature=await pending.connection.sign(pending.challenge.message);if(run!==walletWork||!state)return true;
   await walletRequest({action:'verify',challengeId:pending.challenge.id,signature});pending.connection.release();
   if(run!==walletWork||!state)return true;
   const context=pending.context;closeModal();await load();toast('Wallet control verified');
   if(context.campaignId&&state)receivingWallet(state.campaigns.find(c=>c.id===context.campaignId));
  }catch(e){if(run===walletWork&&state){const context=pending.context;await walletStart(context.campaignId,context.chain);toast(walletError(e),true);}}finally{if(run===walletWork)walletBusy=false;}return true;
 }
 return false;
}
function walletError(error){if(error?.code===-32002)return 'A wallet request is already open. Complete or cancel it in your wallet before retrying.';return error?.code===4001||error?.code==='ACTION_REJECTED'?'Wallet request cancelled.':error?.code===4902?'This network is unavailable in the wallet. Choose another wallet or add the network in your wallet.':error?.message||'Unable to connect this wallet.';}
function walletChange(event){if(event.target.id==='connect-wallet-chain')walletStart(walletContext?.campaignId||null,event.target.value);}
