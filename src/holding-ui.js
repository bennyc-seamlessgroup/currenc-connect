// Private evidence is fetched only for an open, authorized dialog; never cached locally.
let holdingRequest=0;
function holdingUploadForm(c,h=null){
 const resubmitting=!!h;
 openModal(resubmitting?'Update holding evidence':'Submit holding evidence',`<p class="modal-description">${esc(companyList().find(co=>co.id===c.company)?.name)} · ${esc(c.name)} · Record date ${esc(c.snapshotDate)}</p>${notice('Upload a statement showing your name, company and shares on the record date. Company staff will review it.')}<form id="holding-upload-form" data-id="${c.id}" class="form-grid"><input type="hidden" name="organizationId" value="${esc(c.company)}"><input type="hidden" name="campaignId" value="${esc(c.id)}"><input type="hidden" name="version" value="${h?.evidence?.version||0}">${field('Shares held',`<input type="number" name="shares" min="${c.minimum}" max="10000000" step="1" value="${h?.shares||''}" required>`)}${field('Holding date (UTC)',`<input type="date" name="asOf" value="${esc(h?.asOf||c.snapshotDate)}" max="${new Date().toISOString().slice(0,10)}" required>`)}${field('Holding statement',`<input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required><span class="form-hint">PDF, PNG or JPEG · Up to 2 MB</span>`,true)}<button type="submit" class="btn primary span-2">${resubmitting?'Submit updated evidence':'Submit for review'}</button></form>`);
}
async function holdingResponse(response){
 const data=await response.json();
 if(response.status===401||(response.status===403&&data.signIn)){lockWorkspace();render();throw Error('Your session has ended. Please sign in again.');}
 if(['ACCOUNT_REMOVED','ACCOUNT_SUSPENDED'].includes(data.code)){lockWorkspace();authRequired=false;accountRemoved=data.code==='ACCOUNT_REMOVED';accountSuspended=data.code==='ACCOUNT_SUSPENDED';render();throw Error(data.error);}
 if(!response.ok)throw Error(data.error||'Evidence is unavailable.');return data;
}
async function holdingDetails(h){
 const c=state.campaigns.find(c=>c.id===h.campaign),request=++holdingRequest,workspace=workspaceRequest;
 const reviewing=mode==='company'&&can('publish'),mine=isMine(h);
 if(!mine&&!reviewing){toast('Evidence is available to company reviewers only.',true);return;}
 openModal('Holding evidence','<p class="modal-description" role="status">Loading submission…</p>');
 try{
  const data=await holdingResponse(await fetch('/api/holding-evidence?'+new URLSearchParams({organization:c.company,holder:h.id})));
  if(request!==holdingRequest||workspace!==workspaceRequest||!state||!$('#dialog').open)return;
  const latest=data.versions[0],editable=mine&&c.status==='open'&&!c.snapshotAt&&['needs_info','rejected'].includes(data.status);
  const review=reviewing&&!mine&&data.status==='pending'&&c.status==='open'&&!c.snapshotAt;
  const outcomes={approved:'Approved',needs_info:'More information needed',rejected:'Rejected'};
  openModal(review?'Review holding evidence':mine?'Your holding evidence':'Holding evidence',`<div class="evidence-heading">${data.status==='verified'?'<span class="badge verified">Approved</span>':badge(data.status)}<span>${num(h.shares)} shares · ${esc(h.asOf)}</span></div>${latest?.reason?`<section class="evidence-feedback"><strong>${esc(outcomes[latest.decision])}</strong><p>${esc(latest.reason)}</p></section>`:''}${editable?`<div class="modal-actions">${btn('Upload updated evidence','holding-upload','primary',`data-id="${c.id}"`)}</div>`:''}<div class="evidence-versions">${data.versions.map((v,i)=>`<details ${i===0&&!latest?.reason?'open':''}><summary>Version ${v.version} · ${esc(v.decision?outcomes[v.decision]:'Pending review')}</summary><a class="document-link" href="/api/holding-evidence?id=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">${icon('file')}<span>${esc(v.filename)}</span>${icon('download')}</a><p>${num(v.shares)} shares · ${esc(v.as_of)} · Submitted ${esc(time(v.created_at))}</p>${v.decision?`<p>${esc(v.reason)}</p><p class="muted">${esc(v.reviewer||'Company reviewer')} · ${esc(time(v.reviewed_at))}${v.decision==='approved'?` · ${num(v.reviewed_shares)} shares as of ${esc(v.reviewed_as_of)}`:''}</p>`:''}</details>`).join('')}</div>${review?`<form id="holding-review-form" data-id="${h.id}" class="form-grid"><input type="hidden" name="organizationId" value="${esc(c.company)}"><input type="hidden" name="holderId" value="${esc(h.id)}"><input type="hidden" name="evidenceId" value="${esc(latest.id)}">${field('Decision','<select name="decision"><option value="needs_info">Request more information</option><option value="approved">Approve holdings</option><option value="rejected">Reject</option></select>',true)}<div class="evidence-approval form-grid span-2" hidden>${field('Approved shares',`<input type="number" name="shares" min="${c.minimum}" max="10000000" step="1" value="${h.shares}">`)}${field('Approved holding date',`<input type="date" name="asOf" value="${esc(c.snapshotDate)}">`)}<label class="check-line span-2"><input type="checkbox" name="confirmed">I checked the holder name, company, shares and record date.</label></div>${field('Review reason','<textarea name="reason" rows="3" minlength="5" maxlength="1000" required placeholder="Explain your decision or the information needed."></textarea>',true)}<p class="form-hint span-2">Manual campaign eligibility review. This does not complete identity verification or confirm data with a broker.</p><button type="submit" class="btn primary span-2">Save review</button></form>`:mine&&data.status==='verified'?`<div class="modal-actions">${btn('Continue to reward','holding-continue','primary',`data-id="${c.id}"`)}</div>`:data.status==='pending'?notice('Your document is awaiting company review.'):''}`);
 }catch(e){if(request===holdingRequest&&state){closeModal();toast(e.message,true);}}
}
async function holdingAction(a,id){
 if(a==='holding-upload'){const c=state.campaigns.find(c=>c.id===id);holdingUploadForm(c,ownHolder(id));return true;}
 if(a==='holding-details'){const h=state.holders.find(h=>h.id===id);if(h)await holdingDetails(h);return true;}
 if(a==='holding-continue'){join(state.campaigns.find(c=>c.id===id),true);return true;}
 return false;
}
async function holdingSubmit(f,data){
 if(!['holding-upload-form','holding-review-form'].includes(f.id))return false;
 const upload=f.id==='holding-upload-form',body=upload?new FormData(f):JSON.stringify({...data,shares:Number(data.shares),confirmed:!!data.confirmed});
 if(upload){const file=body.get('file');if(!file?.size||file.size>2*1024*1024){toast('Choose a PDF, PNG or JPEG file up to 2 MB.',true);return true;}}
 busy=true;document.body.classList.add('busy');
 try{await holdingResponse(await fetch('/api/holding-evidence',{method:'POST',...(upload?{}:{headers:{'Content-Type':'application/json'}}),body}));closeModal();await load();toast(upload?'Holding evidence submitted':'Review saved');}
 catch(e){toast(e.message,true);}finally{busy=false;document.body.classList.remove('busy');}return true;
}

function holdingChange(e){if(e.target.name==='decision'&&e.target.closest('#holding-review-form')){const form=e.target.closest('form'),approved=e.target.value==='approved';form.querySelector('.evidence-approval').hidden=!approved;form.elements.confirmed.required=approved;}}
