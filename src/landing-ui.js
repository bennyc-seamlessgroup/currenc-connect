function publicHeader(showSignIn=true) {
 return `<header class="public-header"><a class="brand" href="#" data-action="auth-home" aria-label="Currenc Connect introduction">${logo}<span>currenc<span class="brand-sub">CONNECT</span></span></a><nav aria-label="Public navigation">${showSignIn?`<a class="landing-nav-link" href="#campaigns">Campaigns</a><a class="landing-nav-link" href="#how-it-works">How it works</a>${btn('Sign in','auth-start','secondary')}`:btn('Back to introduction','auth-home','text-btn')}</nav></header>`;
}
function publicFooter() {
 return `<footer class="public-footer"><span>© ${new Date().getFullYear()} Currenc Connect</span><span>Shareholder token rewards</span></footer>`;
}
async function loadPublicCampaigns(){
 const request=++publicCampaignRequest;
 try{
  const response=await fetch('/api/public-campaigns');
  if(!response.ok)throw Error('unavailable');
  const data=await response.json();if(request!==publicCampaignRequest)return;
  if(!Array.isArray(data.campaigns))throw Error('unavailable');
  publicCampaigns=data.campaigns;publicCampaignError='';
 }catch{if(request!==publicCampaignRequest)return;publicCampaigns=null;publicCampaignError='Campaigns are temporarily unavailable. Please try again.';}
 if(authRequired&&authView==='landing')render();
}
const publicDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'—';
const publicStatus=c=>c.status==='paused'?'Paused':c.status==='locked'?'Claim window':c.canRegister?'Open for registration':'Registration closed';
const publicRule=c=>c.mode==='ratio'?`${num(c.ratio)} ${esc(c.token)} per share`:`${num(c.budget)} ${esc(c.token)} reward pool`;
const publicAvatar=co=>`<span class="company-avatar" style="--company:${/^#[0-9a-f]{6}$/i.test(co.color||'')?co.color:'#39796f'}">${esc(co.initials||co.name?.slice(0,1)||'C')}</span>`;
function publicCampaignCards(){
 if(publicCampaignError)return `<div class="campaign-empty" role="status"><p>${esc(publicCampaignError)}</p>${btn('Try again','public-retry','secondary')}</div>`;
 if(publicCampaigns===null)return '<p class="campaign-empty" role="status">Loading campaigns…</p>';
 if(!publicCampaigns.length)return '<div class="campaign-empty" role="status"><h3>No current campaigns</h3><p>Published campaigns will appear here when they become available.</p></div>';
 return `<div id="public-campaign-track" class="public-campaign-track ${publicCampaigns.length===1?'is-single':''}" role="region" aria-label="Campaign cards" tabindex="0">${publicCampaigns.map(c=>`<article class="public-campaign-card"><div class="public-company">${publicAvatar(c.company)}<div><strong>${esc(c.company.name)}</strong><span>${esc(c.company.ticker)}</span></div></div><h3>${esc(c.name)}</h3><p class="public-campaign-rule">${publicRule(c)}</p><div class="public-campaign-meta"><span class="public-status ${c.canRegister?'is-open':''}">${esc(publicStatus(c))}</span><span>${c.status==='open'?'Register by':'Claim by'} ${publicDate(c.status==='open'?c.registrationDeadline:c.claimDeadline)}</span></div><button class="btn secondary" data-action="public-campaign" data-id="${esc(c.id)}" aria-label="View ${esc(c.name)}">View campaign ${icon('arrow')}</button></article>`).join('')}</div>`;
}
function publicCampaignSection(){
 return `<section id="campaigns" class="public-campaigns" aria-labelledby="campaigns-title"><div class="public-campaign-heading"><div><h2 id="campaigns-title">Current campaigns</h2><p>Find the company or campaign you were invited to.</p></div><div id="campaign-scroll-controls" class="campaign-scroll-controls" hidden><button id="campaign-scroll-previous" class="icon-btn campaign-previous" data-action="public-scroll" data-direction="previous" aria-label="Previous campaigns" aria-controls="public-campaign-track">${icon('arrow')}</button><button id="campaign-scroll-next" class="icon-btn" data-action="public-scroll" data-direction="next" aria-label="Next campaigns" aria-controls="public-campaign-track">${icon('arrow')}</button></div></div><div id="public-campaign-results">${publicCampaignCards()}</div></section>`;
}
function syncCampaignScroller(){
 const track=$('#public-campaign-track'),controls=$('#campaign-scroll-controls');
 if(!track||!controls||!Number.isFinite(track.clientWidth))return;
 const overflow=track.scrollWidth>track.clientWidth+2;controls.hidden=!overflow;
 $('#campaign-scroll-previous').disabled=track.scrollLeft<=2;
 $('#campaign-scroll-next').disabled=!overflow||track.scrollLeft+track.clientWidth>=track.scrollWidth-2;
}
function initializeCampaignScroller(){
 const track=$('#public-campaign-track');if(!track||!Number.isFinite(track.clientWidth))return;
 track.addEventListener('scroll',syncCampaignScroller,{passive:true});syncCampaignScroller();
}
function publicCampaignBody(c){
 return `<div class="public-company">${publicAvatar(c.company)}<div><strong>${esc(c.company.name)}</strong><span>${esc(c.company.ticker)}</span></div></div>${c.description?`<p class="modal-description">${esc(c.description)}</p>`:''}<dl class="detail-list"><div><dt>Allocation</dt><dd>${publicRule(c)}</dd></div><div><dt>Minimum holding</dt><dd>${num(c.minimum)} shares</dd></div><div><dt>Record date</dt><dd>${publicDate(c.snapshotDate)}</dd></div><div><dt>Registration deadline</dt><dd>${publicDate(c.registrationDeadline)}</dd></div><div><dt>Claim deadline</dt><dd>${publicDate(c.claimDeadline)}</dd></div><div><dt>Receiving networks</dt><dd>${(c.chains||[]).map(chain=>`<span class="inline-chain">${chainIcon(chain)}${esc(CHAIN_NAMES[chain])}</span>`).join(' ')}</dd></div><div><dt>Status</dt><dd>${esc(publicStatus(c))}</dd></div></dl>`;
}
function startPublicCampaign(c){
 requestedCampaign=c.id;
 const url=new URL(window.location.href);url.searchParams.set('campaign',c.id);window.history?.replaceState(null,'',url.toString());
 closeModal();authView='sign-in';authStep='email';authError='';render();window.scrollTo({top:0});$('#login-email')?.focus();
}
async function continueRequestedCampaign(){
 if(!requestedCampaign||!access?.onboarded||authRequired)return;
 const id=requestedCampaign;requestedCampaign=null;
 if(mode!=='shareholder')await load({view:'shareholder'});
 if(authRequired){requestedCampaign=id;return;}
 const c=state?.campaigns.find(c=>c.id===id),co=state?.companies.find(co=>co.id===c?.company);
 if(!c||!co){toast('This campaign is not currently available.',true);return;}
 const entry={...c,company:co,registrationDeadline:registrationEnd(c),claimDeadline:claimEnd(c),status:c.platform?.paused===1?'paused':c.status,canRegister:c.status==='open'&&c.platform?.companyStatus==='approved'&&c.platform?.paused!==1&&c.platform?.visible!==0&&c.platform?.listed!==false&&access.portal?.shareholderRegistrations!==false&&registrationEnd(c)>=new Date().toISOString().slice(0,10)};
 openModal(esc(c.name),`${publicCampaignBody(entry)}<div class="modal-actions">${ownHolder(c.id)||entry.canRegister?btn(ownHolder(c.id)?'View reward':'Register holdings','join','primary',`data-id="${esc(c.id)}"`):btn('Browse companies','close','secondary')}</div>`);
}
async function publicCampaignClick(action,data){
 if(action==='public-retry'){publicCampaignError='';publicCampaigns=null;render();await loadPublicCampaigns();return true;}
 if(action==='public-scroll'){
  const track=$('#public-campaign-track');if(!track?.firstElementChild)return true;
  const step=track.firstElementChild.getBoundingClientRect().width+parseFloat(getComputedStyle(track).columnGap||'0');
  track.scrollBy({left:step*(data.direction==='previous'?-1:1),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'});return true;
 }
 if(!['public-campaign','public-start'].includes(action))return false;
 const c=publicCampaigns?.find(c=>c.id===data.id);if(!c)return true;
 if(action==='public-start'){startPublicCampaign(c);return true;}
 openModal(esc(c.name),`${publicCampaignBody(c)}<div class="modal-actions">${btn('Sign in to continue','public-start','primary',`data-id="${esc(c.id)}"`)}</div>`);return true;
}
function landingPage() {
 return `<div class="public-page">${publicHeader()}<main id="main" class="landing-main"><section class="landing-hero" aria-labelledby="landing-title"><div class="landing-copy"><p class="landing-eyebrow">Shareholder token airdrops</p><h1 id="landing-title" tabindex="-1">Real shares.<br>New rewards.</h1><p class="landing-lead">Token airdrops from the companies you invest in, based on the real shares you hold.</p><p class="landing-detail">Currenc Connect brings company reward campaigns into one place. Your eligible shareholding and each campaign’s rules determine your token allocation.</p><div class="landing-actions">${btn(`Get started ${icon('arrow')}`,'auth-start','primary')}<a class="landing-how-link" href="#campaigns">View campaigns ${icon('down')}</a></div></div><div class="landing-visual"><img src="/images/shareholder-rewards-vertical.jpg" width="1024" height="1536" alt="Shares you hold leading to a token airdrop." fetchpriority="high" decoding="async"></div></section>${publicCampaignSection()}<section id="how-it-works" class="landing-process" aria-labelledby="process-title"><h2 id="process-title">From shareholder to token holder.</h2><ol><li><span class="process-number">01</span><div><h3>Find your company</h3><p>Choose a reward campaign from a participating company.</p></div></li><li><span class="process-number">02</span><div><h3>Confirm your holding</h3><p>Complete the campaign’s identity and shareholding checks.</p></div></li><li><span class="process-number">03</span><div><h3>Receive your allocation</h3><p>Add a wallet and claim when your rewards become available.</p></div></li></ol></section></main>${publicFooter()}</div>`;
}
