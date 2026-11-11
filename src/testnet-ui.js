let testnetWork=0,testnetBusy=false,testnetPending=null,testnetScope=null;
const testnetStatus={prepared:'Awaiting wallet',submitted:'Submitted',included:'Included · awaiting finality',confirmed:'Confirmed',reverted:'Reverted'};
function cancelTestnetFlow(){testnetWork++;testnetBusy=false;testnetPending?.connection?.release();testnetPending=null;}
function testnetRewardCard(c,h,co){return `<section class="panel reward-card"><div class="reward-heading"><div><span class="muted">${esc(co.name)}</span><h2>${esc(c.name)}</h2></div><span class="badge pending">Sepolia pilot</span></div><div class="reward-metrics"><div><span>Synthetic allocation</span><strong>${num(h.allocation)} <span>${esc(c.token)}</span></strong></div><div><span>Confirmed claims</span><strong>${num(h.claimed)} <span>${esc(c.token)}</span></strong></div><div><span>Deployment</span><strong class="testnet-state-label">${c.testnet?.contract?'Deployed':'Not deployed'}</strong></div></div><div class="reward-bottom"><span>${chainIcon('ETH')}Sepolia · <span class="mono">${esc(short(h.wallet))}</span></span>${btn('View testnet reward','testnet-open','primary',`data-id="${c.id}"`)}</div></section>`;}
function testnetTransactionDetails(t){openModal('Confirmed Sepolia transaction',`<dl class="detail-list"><div><dt>Network</dt><dd>Ethereum Sepolia</dd></div><div><dt>Transaction hash</dt><dd class="mono wrap">${esc(t.transactionHash)}</dd></div><div><dt>Receiving address</dt><dd class="mono wrap">${esc(t.wallet)}</dd></div><div><dt>Test amount</dt><dd>${num(t.amount)}</dd></div><div><dt>Block</dt><dd>${esc(t.blockNumber)}</dd></div></dl>${testnetLink(t.transactionHash)}${notice('This transaction is confirmed on Sepolia. These are test tokens, not a mainnet distribution.')}`);}
const testnetLink=(hash,token=false)=>`<a class="text-btn" href="https://sepolia.etherscan.io/${token?'token':'tx'}/${esc(hash)}" target="_blank" rel="noopener noreferrer">${token?'View test token':'View transaction'} ${icon('external')}</a>`;
async function testnetRequest(action,input){
 const response=await fetch('/api/testnet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}),data=await response.json();
 if(response.status===401||response.status===403&&data.signIn){lockWorkspace();render();throw Error('Your session ended. Sign in again.');}
 if(['ACCOUNT_REMOVED','ACCOUNT_SUSPENDED'].includes(data.code)){lockWorkspace();authRequired=false;accountRemoved=true;render();throw Error(data.error);}
 if(!response.ok)throw Error(data.error||'Unable to load Sepolia status.');return data;
}
function testnetPilotForm(){
 if(!access||!can('treasury'))return;
 const wallets=verifiedWallets.filter(w=>w.chain==='ETH');
 openModal('New testnet pilot',`<p class="modal-description">A private Sepolia activity for your verified wallet. It uses a synthetic allocation and does not require KYC or holding documents.</p>${wallets.length?`<form id="testnet-pilot-form" class="form-grid">${field('Pilot name','<input name="name" required maxlength="70" value="Sepolia wallet pilot">',true)}${field('Test tokens','<input name="amount" type="number" min="1" max="1000000" step="1" value="100" required>',true)}${field('Receiving wallet',`<select name="walletId">${wallets.map(w=>`<option value="${w.id}">${esc(w.address)}</option>`).join('')}</select>`,true)}<label class="check-row span-2"><input name="testDataConsent" type="checkbox" required><span>I am using a synthetic allocation. Claiming publishes this wallet and test amount on Sepolia.</span></label><button class="btn primary span-2" type="submit">Create private pilot</button></form>`:`<p>Connect and verify an Ethereum wallet in the shareholder portal first.</p>${btn('Open shareholder portal','mode','primary','data-mode="shareholder"')}`}`);
}
async function testnetOpen(c){
 if(!c)return;cancelTestnetFlow();testnetScope={organizationId:c.company,campaignId:c.id};const run=testnetWork;
 openModal('Sepolia testnet','<p role="status">Loading transaction status…</p>');
 try{
  const data=await testnetRequest('status',testnetScope);if(run!==testnetWork||!state)return;
  const admin=mode==='company'&&can('treasury'),deployment=data.deployment;
  openModal('Sepolia testnet',`<div class="modal-status"><span class="badge pending">Private testnet pilot</span><strong>${esc(c.name)}</strong></div><dl class="detail-list"><div><dt>Network</dt><dd>Ethereum Sepolia</dd></div><div><dt>Deployment</dt><dd>${deployment?testnetStatus[deployment.status]:'Not deployed'}</dd></div>${data.contract?`<div><dt>Test token</dt><dd class="mono wrap">${esc(data.contract)}</dd></div><div><dt>On-chain claims</dt><dd>${data.paused?'Paused':'Open'}</dd></div>`:''}</dl>${data.contract?testnetLink(data.contract,true):''}${notice('Test tokens have no asset value. Deployment and claims use Sepolia test ETH for gas. Confirmed records are saved after Ethereum finalizes the transaction.')}${admin?notice('The deployment wallet controls the contract pause, including after portal roles change. Portal account or campaign controls do not stop direct on-chain claims.'):''}${deployment?`<div class="testnet-activity">${data.transactions.map(t=>`<div class="testnet-transaction"><div><strong>${esc({deploy:'Test token deployment',claim:'Token claim',pause:'Pause claims',resume:'Resume claims'}[t.kind])}</strong><span>${testnetStatus[t.status]}</span>${t.status==='prepared'&&t.own?'<span>Already sent? Add its transaction hash to avoid sending again.</span>':''}</div><div>${t.hash?testnetLink(t.hash):t.own?btn('Add transaction hash','testnet-recover','text-btn',`data-intent="${t.id}"`):''}${t.hash&&!['confirmed','reverted'].includes(t.status)&&(admin||t.own)?btn('Check status','testnet-check','secondary',`data-intent="${t.id}"`):''}</div></div>`).join('')}</div>`:''}<div class="modal-actions">${btn('Refresh','testnet-open','secondary',`data-id="${c.id}"`)}${admin&&c.status==='locked'&&(!deployment||state.holders.filter(h=>h.campaign===c.id).every(h=>h.claimed>=h.allocation))?btn('Archive pilot','testnet-archive','secondary',`data-id="${c.id}"`):''}${admin&&!deployment&&c.status==='locked'?btn('Prepare deployment','testnet-prepare-deploy','primary',`data-id="${c.id}"`):''}${admin&&deployment?.status==='prepared'&&data.transactions.find(t=>t.id===deployment.id)?.own?btn('Continue deployment','testnet-continue','primary',`data-id="${c.id}" data-kind="deploy"`):''}${admin&&c.status==='locked'&&data.contract?btn(data.paused?'Resume on Sepolia':'Pause on Sepolia','testnet-controller','secondary',`data-id="${c.id}" data-kind="${data.paused?'resume':'pause'}"`):''}${!admin&&c.status==='locked'&&data.contract&&ownHolder(c.id)?.claimed===0&&!data.transactions.some(t=>t.kind==='claim'&&t.own&&['submitted','included','confirmed'].includes(t.status))?btn('Claim test tokens','testnet-continue','primary',`data-id="${c.id}" data-kind="claim"`):''}</div>`);
 }catch(e){if(run===testnetWork&&state){closeModal();toast(e.message,true);}}
}
function testnetDeployForm(c,kind='deploy'){
 const wallets=verifiedWallets.filter(w=>w.chain==='ETH');
 openModal(kind==='deploy'?'Deploy test token':'Contract controls',`<p class="modal-description">${esc(c.name)} · Ethereum Sepolia</p><form id="testnet-prepare-form" data-id="${c.id}" data-kind="${kind}" class="form-grid">${field('Deployment wallet',`<select name="walletId" required>${wallets.map(w=>`<option value="${w.id}">${esc(w.address)}</option>`).join('')}</select>`,true)}${notice('You will review the transaction before confirming it in your wallet. Sepolia test ETH is required for gas.')}<button class="btn primary span-2" type="submit">Review ${kind==='deploy'?'deployment':kind}</button></form>`);
}
async function testnetPrepare(c,kind,walletId=null,consent=false){
 const w=verifiedWallets.find(w=>w.id===walletId),scope={organizationId:c.company,campaignId:c.id};
 const start=testnetWork;const transaction=await testnetRequest('prepare',{...scope,kind,walletId:w?.id,walletRevision:w?.revision,testDataConsent:consent});if(start!==testnetWork||!state)return;
 if(transaction.status!=='prepared'){await testnetOpen(c);return;}
 cancelTestnetFlow();testnetScope=scope;testnetPending={transaction,campaignId:c.id};const run=testnetWork;
 const {walletRuntime}=await walletRuntimeModule();if(run!==testnetWork||!state)return;
 const choices=walletRuntime.discover('ETH');
 openModal('Connect for Sepolia',`<p class="modal-description">Use the wallet for this action:</p><p class="mono wallet-full-address">${esc(transaction.from)}</p><div class="wallet-provider-list">${choices.length?choices.map(w=>btn(`${icon('wallet')}${esc(w.name)}`,'testnet-connect','secondary full',`data-provider="${esc(w.id)}"`)).join(''):'<p>No compatible Ethereum wallet detected. On mobile, use the wallet app browser.</p>'}</div>${notice('The wallet will switch to Ethereum Sepolia. No mainnet transaction is requested.')}`);
}
async function testnetAction(action,data){
 if(!action.startsWith('testnet-'))return false;
 const requestRun=testnetWork,c=state?.campaigns.find(c=>c.id===(data.id||testnetScope?.campaignId));
 try{
  if(action==='testnet-pilot'){testnetPilotForm();return true;}
  if(action==='testnet-archive'){
   openModal('Archive testnet pilot',`<p class="modal-description">${esc(c.name)}</p>${notice('Unused or fully settled pilots can be archived. Test allocations, token details and transaction history are retained; archiving does not change the deployed contract.')}<div class="modal-actions">${btn('Cancel','close','secondary')}${btn('Archive pilot','testnet-archive-confirm','primary',`data-id="${c.id}"`)}</div>`);return true;
  }
  if(action==='testnet-archive-confirm'){
   await testnetRequest('archive',{organizationId:c.company,campaignId:c.id});if(requestRun!==testnetWork||!state)return true;closeModal();await load();page='campaigns';filter='archived';render();return true;
  }
  if(action==='testnet-open'){await testnetOpen(c);return true;}
  if(action==='testnet-prepare-deploy'){testnetDeployForm(c);return true;}
  if(action==='testnet-controller'){testnetDeployForm(c,data.kind);return true;}
  if(action==='testnet-continue'){
   if(data.kind==='deploy'){testnetDeployForm(c);return true;}
   await testnetPrepare(c,data.kind);return true;
  }
  if(action==='testnet-check'){
   await testnetRequest('reconcile',{...testnetScope,intentId:data.intent});if(requestRun!==testnetWork||!state)return true;await load();if(requestRun!==testnetWork||!state)return true;await testnetOpen(state.campaigns.find(row=>row.id===c.id));return true;
  }
  if(action==='testnet-recover'){
   openModal('Recover submitted transaction',`<p class="modal-description">Paste the Sepolia transaction hash from your wallet activity. This records an existing transaction and does not send another one.</p><form id="testnet-recover-form" data-intent="${data.intent}" class="form-grid">${field('Transaction hash','<input name="hash" required pattern="0x[0-9a-fA-F]{64}" maxlength="66" class="mono" autocomplete="off">',true)}<button class="btn primary span-2" type="submit">Check transaction</button></form>`);return true;
  }
  if(action==='testnet-connect'){
   if(testnetBusy||!testnetPending)return true;testnetBusy=true;const run=testnetWork,pending=testnetPending;
   try{
    const {walletRuntime}=await walletRuntimeModule(),connection=await walletRuntime.connectTestnet(data.provider);
    if(run!==testnetWork||!state){connection.release();return true;}
    if(connection.address.toLowerCase()!==pending.transaction.from.toLowerCase()){connection.release();throw Error('Select the displayed receiving or deployment address in your wallet, then reconnect.');}
    pending.connection=connection;
    openModal('Review Sepolia transaction',`<dl class="detail-list"><div><dt>Campaign</dt><dd>${esc(pending.transaction.campaignName)}</dd></div>${['deploy','claim'].includes(pending.transaction.kind)?`<div><dt>${pending.transaction.kind==='deploy'?'Maximum test supply':'Test tokens to receive'}</dt><dd>${num(pending.transaction.amount)} ${esc(pending.transaction.token)}</dd></div>`:''}<div><dt>Action</dt><dd>${esc({deploy:'Deploy new test token',claim:'Claim test tokens',pause:'Pause claims',resume:'Resume claims'}[pending.transaction.kind])}</dd></div><div><dt>Network</dt><dd>Ethereum Sepolia</dd></div><div><dt>Wallet</dt><dd class="mono wrap">${esc(pending.transaction.from)}</dd></div>${pending.transaction.to?`<div><dt>Contract</dt><dd class="mono wrap">${esc(pending.transaction.to)}</dd></div>`:''}<div><dt>Native ETH sent</dt><dd>0 · test ETH gas only</dd></div></dl>${notice('Confirm the network and fee in your wallet. This is an on-chain test transaction, not an ownership message signature.')}<details class="wallet-message"><summary>Transaction data</summary><pre>${esc(pending.transaction.data)}</pre></details><div class="modal-actions">${btn('Confirm in wallet','testnet-send','primary')}</div>`);
   }finally{if(run===testnetWork)testnetBusy=false;}return true;
  }
  if(action==='testnet-send'){
   if(testnetBusy||!testnetPending?.connection)return true;testnetBusy=true;const run=testnetWork,pending=testnetPending,scope={...testnetScope};let hash;
   try{
    const button=$('[data-action="testnet-send"]');if(button){button.disabled=true;button.textContent='Confirm in your wallet…';}
    hash=await pending.connection.sendTestnet(pending.transaction);
    // A broadcast cannot be cancelled by closing a dialog. Record the returned hash
    // even when the user has navigated away; the server still checks the identity.
    await testnetRequest('submit',{...scope,intentId:pending.transaction.id,hash});
    if(run===testnetWork&&state){closeModal();await load();await testnetOpen(state.campaigns.find(row=>row.id===pending.campaignId));toast('Transaction submitted. Check status for chain confirmation.');}
   }catch(e){if(run===testnetWork&&state){
    if(hash)openModal('Keep your transaction hash',`<p>${esc(e.message)}</p><p class="mono wallet-full-address">${esc(hash)}</p>${notice('Use Add transaction hash in this pilot to recover its status. Do not submit another wallet transaction while this one is pending.')}${btn('Close','close','secondary')}`);
    else {toast(walletError(e),true);const button=$('[data-action="testnet-send"]');if(button){button.disabled=false;button.textContent='Confirm in wallet';}}
   }}finally{if(run===testnetWork)testnetBusy=false;}return true;
  }
 }catch(e){toast(e.message,true);}
 return true;
}
async function testnetSubmit(form,data){
 if(!form.id.startsWith('testnet-'))return false;
 if(testnetBusy)return true;testnetBusy=true;const run=testnetWork;
 try{
  if(form.id==='testnet-pilot-form'){
   const w=verifiedWallets.find(w=>w.id===data.walletId),created=await testnetRequest('pilot',{organizationId:companyId,name:data.name,amount:data.amount,walletId:w?.id,walletRevision:w?.revision,testDataConsent:data.testDataConsent==='on'});if(run!==testnetWork||!state)return true;
   closeModal();await load();page='campaigns';filter='locked';render();await testnetOpen(state.campaigns.find(c=>c.id===created.campaignId));
  }else if(form.id==='testnet-prepare-form'){
   const c=state.campaigns.find(c=>c.id===form.dataset.id);await testnetPrepare(c,form.dataset.kind,data.walletId,data.testDataConsent==='on');
  }else if(form.id==='testnet-recover-form'){
   const scope={...testnetScope};await testnetRequest('submit',{...scope,intentId:form.dataset.intent,hash:data.hash});if(run!==testnetWork||!state)return true;await testnetOpen(state.campaigns.find(c=>c.id===scope.campaignId));
  }
 }catch(e){toast(e.message,true);}finally{testnetBusy=false;}
 return true;
}
