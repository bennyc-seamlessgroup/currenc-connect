function suspendedAccountPage(){return `<main class="auth-page"><div class="auth-wrap"><section class="auth-card"><h1>Account suspended</h1><p class="auth-intro">Contact the platform administrator to restore access.</p>${btn('Sign out','sign-out','primary full')}</section></div></main>`;}
function approvalLabel(status){return {draft:'Inactive',pending:'Inactive',needs_info:'Inactive',approved:'Active',rejected:'Inactive',suspended:'Suspended'}[status]||status;}
function reviewActionLabel(action){return {activate:'Activated',deactivate:'Deactivated',approve:'Previously approved',reject:'Previously rejected','request-info':'Previous information request',suspend:'Company suspended',resume:'Company restored',hide:'Hidden from portal',show:'Listed on portal'}[action]||action;}
function approvalBadge(status){return `<span class="badge ${status==='approved'?'verified':status==='suspended'||status==='rejected'?'rejected':'pending'}">${esc(approvalLabel(status))}</span>`;}
function portalNotice(){return access?.portal?.announcement?`<div class="workspace-notice">${icon('bell')}<span>${esc(access.portal.announcement)}</span></div>`:'';}
function companyApprovalNotice(){return access&&mode==='company'&&workspaceContext?.approvalStatus!=='approved'?`<div class="workspace-notice"><strong>${esc(approvalLabel(workspaceContext.approvalStatus))}</strong><span>Contact the platform team to activate this company.</span></div>`:'';}
function campaignClaimEnabled(c){return !c.platform||(c.platform.companyStatus==='approved'&&c.platform.paused!==1);}
function campaignInteractionEnabled(c,registered){
 if(!access)return true;
 if(c.platform&&c.platform.companyStatus!=='approved'){openModal('Company unavailable',notice('This company is not currently active for portal activity. Your saved records are retained.'));return false;}
 if(!registered&&(c.platform?.paused===1||c.platform?.visible===0||c.platform?.listed===false||access.portal?.shareholderRegistrations===false)){openModal('Registrations paused',notice('New registrations are not available for this campaign.'));return false;}
 return true;
}
function companyInfoFields(info={}){return Object.entries({legalName:'Legal company name',registrationNumber:'Registration number',jurisdiction:'Jurisdiction',website:'Official website',address:'Registered address',contactName:'Contact name',contactEmail:'Contact email',representativeRole:'Contact role',listingMarket:'Exchange / market (if listed)'}).map(([key,label])=>field(label,`<input name="${key}" type="${key==='contactEmail'?'email':key==='website'?'url':'text'}" maxlength="${key==='address'?400:key==='website'?300:key==='contactEmail'?254:key==='listingMarket'?40:['registrationNumber','jurisdiction','contactName','representativeRole'].includes(key)?80:120}" value="${esc(info[key]||'')}">`,['legalName','website','address'].includes(key))).join('');}
function companyInfo(values){return Object.fromEntries(['legalName','registrationNumber','jurisdiction','website','address','contactName','contactEmail','representativeRole','listingMarket'].map(k=>[k,values[k]||'']));}
function documentLinks(docs){return docs.length?`<div class="document-list">${docs.map(d=>`<a class="document-link" href="/api/company-document?id=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${icon('file')}<span>${esc(d.filename)}</span><span>${num(Math.ceil(d.size/1024))} KB</span>${icon('download')}</a>`).join('')}</div>`:'<p class="subtle-empty">No documents uploaded.</p>';}
function platformSearchForm(){return `<form id="platform-search-form" class="platform-search"><label class="search">${icon('search')}<input name="search" placeholder="Search companies or accounts" value="${esc(platformSearch)}" aria-label="Search platform"></label><button type="submit" class="btn secondary">Search</button></form>`;}
function platformPagination(kind){const more=platformData?.pagination?.[kind+'More'];return `<div class="pagination"><button class="btn secondary" data-action="platform-page" data-step="-1" ${platformListPage<=1?'disabled':''}>Previous</button><span>Page ${platformListPage}</span><button class="btn secondary" data-action="platform-page" data-step="1" ${more?'':'disabled'}>Next</button></div>`;}
function platformCompanyTable(rows,emptyMessage='No companies found'){return `<section class="panel table-wrap"><table><thead><tr><th>Company</th><th>Managed by</th><th>Status</th><th>Portal</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(c=>`<tr><td><strong>${esc(c.company.name)}</strong></td><td>${esc(c.owner_email)}</td><td>${approvalBadge(c.status)}</td><td>${c.status==='approved'&&c.visible===1?'Listed':'Hidden'}</td><td>${btn('Manage','platform-company','text-btn',`data-id="${c.id}"`)}</td></tr>`).join('')}</tbody></table>${!rows.length?empty(emptyMessage,''):''}</section>`;}
function platformContent(){
 const p=platformData;if(!p)return empty('Loading platform','');
 if(page==='platform-company'&&p.company)return platformCompanyDetail(p.company);
 if(page==='portal-settings')return platformSettingsPage();
 if(page==='platform-accounts')return platformAccountsPage();
 if(page==='platform-audit')return `${title('Platform audit log')}<section class="panel">${platformAudit(p.audit)}</section>${platformPagination('audit')}`;
 if(page==='platform-companies')return `${title('Companies',btn(`${icon('plus')}Add company`,'platform-new-company','primary'))}${platformSearchForm()}${platformCompanyTable(p.companies)}${platformPagination('company')}`;
 return `${title('Platform overview',btn(`${icon('plus')}Add company`,'platform-new-company','primary'))}<div class="stats-grid">${stat('Active companies',p.counts.approved||0)}${stat('Inactive companies',['draft','pending','needs_info','rejected'].reduce((n,k)=>n+(p.counts[k]||0),0))}${stat('Suspended companies',p.counts.suspended||0)}</div><div class="section-heading"><h2>Companies</h2>${btn('View all companies','nav','text-btn','data-page="platform-companies"')}</div>${platformCompanyTable(p.companies)}`;
}
function auditDescription(row){
 let detail;try{detail=JSON.parse(row.detail);}catch{return row.detail;}
 if(!detail||typeof detail!=='object')return String(detail||'');
 if(detail.filename)return `${detail.purpose==='authority'?'Representative authority':'Company registration'}: ${detail.filename} · ${Math.ceil(detail.size/1024)} KB`;
 if(detail.from&&detail.to)return `${detail.from!==detail.to?`${approvalLabel(detail.from)} → ${approvalLabel(detail.to)} · `:''}${detail.visible?'Listed':'Hidden'} · ${detail.note||''}`;
 if(detail.reason)return detail.reason;
 if(detail.member){const person=platformData?.accounts.find(a=>a.id===detail.member);return `${person?.email||'Company member'} · ${detail.role}`;}
 if(typeof detail.shareholderRegistrations==='boolean')return `Shareholder registrations ${detail.shareholderRegistrations?'open':'paused'}${detail.announcement?' · Notice: '+detail.announcement:''}`;
 if(detail.revision!==undefined)return 'Company record updated';
 return row.action;
}
function platformAudit(rows){return activityList(rows.map(r=>({at:r.created_at,title:reviewActionLabel(r.action),detail:`${auditDescription(r)} · ${r.actor}`,kind:'info'})));}
function platformCompanyDetail(c){
 const approvalActions=[];
 if(c.status==='approved')approvalActions.push([c.visible===1?'hide':'show',c.visible===1?'Hide from portal':'List on portal','secondary'],['deactivate','Deactivate company','secondary'],['suspend','Suspend company','danger']);
 else if(c.status==='suspended')approvalActions.push(['resume','Restore company','primary']);
 else approvalActions.push(['activate','Activate company','primary'],['suspend','Suspend company','danger']);
 return `${title(esc(c.company.name),btn('Back','nav','secondary','data-page="platform-companies"'))}<div class="approval-heading">${approvalBadge(c.status)}<span>${c.status==='approved'&&c.visible===1?'Listed on portal':'Hidden from portal'}</span></div><section class="panel application-panel"><h2>Company information</h2><form id="platform-save-company-form" class="form-grid">${field('Company name',`<input name="name" value="${esc(c.company.name)}" required maxlength="80">`,true)}${field('Ticker',`<input name="ticker" value="${esc(c.company.ticker)}" required maxlength="12" pattern="[A-Za-z0-9.-]+">`)}${field('Test token symbol',`<input value="${esc(c.company.token)}" disabled>`)}${companyInfoFields(c.application)}<button class="btn primary span-2" type="submit">Save company information</button></form></section><section class="panel application-panel"><h2>Portal access</h2><div class="form-actions">${approvalActions.map(([action,label,cls])=>btn(label,'platform-review',cls,`data-review="${action}" data-id="${c.id}"`)).join('')}</div></section>${c.documents.length?`<section class="panel application-panel"><h2>Internal files</h2>${documentLinks(c.documents)}</section>`:''}<section class="panel application-panel"><h2>Company administrators</h2><div class="table-wrap"><table><thead><tr><th>Account</th><th>Role</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${c.members.map(m=>`<tr><td>${esc(m.email)}</td><td>${esc(m.role)}</td><td>${m.role!=='owner'?btn('Change role','platform-company-member','text-btn',`data-id="${m.id}"`):''}</td></tr>`).join('')}</tbody></table></div><form id="platform-company-admin-form" class="form-grid admin-appointment">${field('Registered account email','<input name="email" type="email" required autocomplete="off">',true)}<button class="btn secondary span-2" type="submit">Appoint company administrator</button></form></section><section class="panel application-panel"><h2>Campaign visibility</h2>${c.campaigns.length?c.campaigns.map(r=>`<div class="moderation-row"><div><strong>${esc(['curr-welcome','curr-loyalty','north-welcome','harbor-welcome'].includes(r.legacyId)?legacyCopy[r.name]??r.name:r.name)}</strong><p>${esc(r.status)} · ${['draft','closed'].includes(r.status)?'Not published':c.status==='approved'&&c.visible===1&&r.visible===1?'Listed':'Hidden'}${r.paused===1?' · Platform paused':''}</p></div><div class="row-actions">${btn(r.visible===1?'Hide':'Show','platform-campaign','text-btn',`data-id="${r.id}" data-review="${r.visible===1?'hide':'show'}"`)}${btn(r.paused===1?'Resume':'Pause','platform-campaign','text-btn',`data-id="${r.id}" data-review="${r.paused===1?'resume':'pause'}"`)}</div></div>`).join(''):empty('No campaigns','')}</section>${c.reviews.length?`<section class="panel activity-panel"><div class="panel-head"><h2>Status history</h2></div>${activityList(c.reviews.map(r=>({at:r.created_at,title:reviewActionLabel(r.action),detail:`${r.note} · ${r.reviewer}`,kind:'info'})))}</section>`:''}`;
}
function platformAccountsPage(){
 const rows=platformData.accounts,owner=access.platformRole==='owner';
 return `${title('Accounts')}${platformSearchForm()}<section class="panel table-wrap"><table><thead><tr><th>Account</th><th>Status</th><th>Platform access</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${esc(a.name||a.email)}</strong>${a.name?`<small>${esc(a.email)}</small>`:''}</td><td>${esc(a.status)}</td><td>${esc(a.platform_role||'None')}</td><td><div class="row-actions">${!a.platform_role?btn(a.status==='suspended'?'Restore':'Suspend','platform-account','text-btn',`data-id="${a.id}"`):''}${owner&&a.platform_role!=='owner'?btn(a.platform_role?'Remove platform access':'Grant platform access','platform-admin','text-btn',`data-id="${a.id}"`):''}</div></td></tr>`).join('')}</tbody></table></section>${platformPagination('account')}`;
}
function platformSettingsPage(){const s=platformData.settings;return `${title('Portal settings')}<section class="panel application-panel"><form id="portal-settings-form" class="form-grid"><label class="checkbox-line span-2"><input type="checkbox" name="shareholderRegistrations" ${s.shareholder_registrations===1?'checked':''}>Accept new shareholder campaign registrations</label>${field('Portal announcement',`<textarea name="announcement" maxlength="300" rows="3">${esc(s.announcement)}</textarea>`,true)}<button class="btn primary span-2" type="submit">Save portal settings</button></form></section>`;}
function reasonForm(title,type,values,extra=''){openModal(title,`<form id="platform-action-form" data-type="${type}" data-values="${esc(JSON.stringify(values))}" class="form-grid">${extra}${field('Reason','<textarea name="note" required minlength="3" maxlength="1000" rows="3"></textarea>',true)}<button class="btn primary span-2" type="submit">Confirm</button></form>`);}
async function governanceClick(action,data){
 if(action==='platform-new-company'){organizationForm();return true;}
 if(action==='platform-company'){platformCompanyId=data.id;page='platform-company';await load({view:'platform',organizationId:data.id,page:platformListPage,search:platformSearch});render();window.scrollTo(0,0);return true;}
 if(action==='platform-page'){platformListPage=Math.max(1,platformListPage+Number(data.step));await load({view:'platform',page:platformListPage,search:platformSearch});return true;}
 if(action==='platform-review'){
  const c=platformData?.company;if(!c)return true;
  reasonForm('Update company status','platform-review-company',{organizationId:c.id,revision:c.revision,action:data.review});return true;
 }
 if(action==='platform-campaign'){const c=platformData?.company,r=c?.campaigns.find(r=>r.id===data.id);if(!r)return true;reasonForm('Moderate campaign','platform-campaign-control',{organizationId:c.id,campaignId:r.id,revision:r.revision,action:data.review});return true;}
 if(action==='platform-account'){const a=platformData.accounts.find(a=>a.id===data.id);if(a)reasonForm(a.status==='suspended'?'Restore account':'Suspend account','platform-account-status',{accountId:a.id,status:a.status==='suspended'?'active':'suspended',revision:a.control_revision});return true;}
 if(action==='platform-admin'){const a=platformData.accounts.find(a=>a.id===data.id);if(a)reasonForm(a.platform_role?'Remove platform administrator':'Grant platform administrator','platform-admin-access',{accountId:a.id,grant:!a.platform_role},notice(`${esc(a.email)} ${a.platform_role?'will lose':'will gain'} access to company records, internal files and platform controls.`));return true;}
 if(action==='platform-company-member'){const c=platformData.company,m=c.members.find(m=>m.id===data.id);if(m)openModal('Company member role',`<form id="platform-member-form" data-id="${m.id}" class="form-grid">${field('Company role',`<select name="role">${['admin','operator','viewer'].map(r=>`<option value="${r}" ${r===m.role?'selected':''}>${r}</option>`).join('')}</select>`,true)}<button class="btn primary span-2" type="submit">Save company role</button></form>`);return true;}
 return false;
}
async function governanceSubmit(form,data,event){
 if(form.id==='platform-create-company-form'){
  if(await command({type:'platform-create-company',...data},'Company added')){platformCompanyId=platformData.company.id;page='platform-company';render();}return true;
 }
 if(form.id==='platform-save-company-form'){
  const c=platformData.company;await command({type:'platform-save-company',organizationId:c.id,revision:c.revision,organizationRevision:c.organizationRevision,name:data.name,ticker:data.ticker,info:companyInfo(data)},'Company information saved');return true;
 }
 if(form.id==='platform-action-form'){const values=JSON.parse(form.dataset.values);await command({type:form.dataset.type,...values,note:data.note},'Platform update saved');return true;}
 if(form.id==='portal-settings-form'){await command({type:'platform-settings',revision:platformData.settings.revision,shareholderRegistrations:data.shareholderRegistrations==='on',announcement:data.announcement},'Portal settings saved');return true;}
 if(form.id==='platform-search-form'){platformSearch=data.search||'';platformListPage=1;await load({view:'platform',page:1,search:platformSearch});return true;}
 if(form.id==='platform-member-form'){await command({type:'platform-company-admin',organizationId:platformData.company.id,memberId:form.dataset.id,role:data.role},'Company member role saved');return true;}
 if(form.id==='platform-company-admin-form'){
  // Resolve registered email server-side; the requester never chooses an account by a display name.
  await command({type:'platform-company-admin',organizationId:platformData.company.id,memberEmail:data.email,role:'admin'},'Company administrator appointed');return true;
 }
 return false;
}
