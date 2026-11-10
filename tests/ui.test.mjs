// Exercise rendering and event handlers without a browser or external dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {seedState,applyCommand} from '../lib/domain.ts';
import {createPlatform} from '../server/platform.mjs';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
const domain=stripTypeScriptTypes(readFileSync('lib/domain.ts','utf8')).replace(/^export /gm,'');
const chainLogos=Object.fromEntries([['ETH','ethereum'],['SOL','solana'],['BNB','bnb']].map(([chain,file])=>[chain,'data:image/svg+xml;base64,'+readFileSync(`src/assets/chains/${file}.svg`).toString('base64')]));
const app='const chainLogoData='+JSON.stringify(chainLogos)+';\n'+readFileSync('src/app.js','utf8').replace(/^import[^\n]+\n/,'')+'\n'+readFileSync('src/governance-ui.js','utf8')+'\n'+readFileSync('src/campaign-ui.js','utf8')+'\n'+readFileSync('src/portal-ui.js','utf8')+'\n'+readFileSync('src/landing-ui.js','utf8');
function harness({requiresLogin=false,platform=null,actor=null,search='',publicRows=[],publicDatabase=null}={}){
 let signedIn=!requiresLogin;
 let stored=seedState();const nodes={};const handlers={};const storage=new Map();
 const node=(id)=>nodes[id] ||= {innerHTML:'',className:'',open:false,value:'',dataset:{},addEventListener(){},classList:{add(){},remove(){}},showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){}};
 const context=vm.createContext({console,crypto,structuredClone,setTimeout:()=>1,clearTimeout(){},Blob,URL,URLSearchParams,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{querySelector:node,addEventListener:(k,v)=>handlers[k]=v,body:{classList:{add(){},remove(){}}}},
  window:{location:{search,href:'https://test.local/'+search},addEventListener(){},scrollTo(){}},
  FormData:class{constructor(f){this.entries=Object.entries(f.fields||{});}*[Symbol.iterator](){yield* this.entries;}getAll(k){return this.entries.filter(([a])=>a===k).map(([,v])=>v);}},
  fetch:async(_url,options)=>{
   if(_url==='/api/public-campaigns')return {ok:true,status:200,json:async()=>publicDatabase?readPublicCampaigns(publicDatabase):{campaigns:publicRows}};
   if(_url.startsWith('/api/auth')) {
    const action=new URL('https://test.local'+_url).searchParams.get('action');
    const body=JSON.parse(options.body);
    if(action==='verify-code'&&body.code!=='123456')return {ok:false,status:400,json:async()=>({error:'Invalid code'})};
    if(action==='verify-code')signedIn=true;
    if(action==='sign-out')signedIn=false;
    return {ok:true,status:200,json:async()=>({success:true})};
   }
   if(!signedIn)return {ok:false,status:401,json:async()=>({signIn:true,error:'Sign in'})};
   if(platform){try{const url=new URL('https://test.local'+_url);let selection={view:url.searchParams.get('view')||undefined,organizationId:url.searchParams.get('organization')||undefined,page:url.searchParams.get('page'),search:url.searchParams.get('search'),accountFilter:url.searchParams.get('accounts')};if(options?.method==='POST')selection=await platform.execute(actor,JSON.parse(options.body));const data=await platform.read(actor,selection);return {ok:true,status:200,json:async()=>({...data,user:actor.user})};}catch(error){return {ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   try{if(options?.method==='POST')stored=applyCommand(stored,JSON.parse(options.body));return{ok:true,status:200,json:async()=>({state:stored,...(requiresLogin?{user:{name:'Account owner',email:'owner@example.com'}}:{})})};}catch(e){return{ok:false,status:422,json:async()=>({error:e.message})};}
  }
 });
 vm.runInContext(domain+'\n'+app+'\n globalThis.ui={load,loadPublicCampaigns,render,join,createForm,detail,get state(){return state;}}',context);
 return{context,nodes,handlers,expire(){signedIn=false;},async start(selection){await context.ui.load(selection);await context.ui.loadPublicCampaigns();},async click(action,dataset={}){await handlers.click({preventDefault(){},target:{closest(){return {dataset:{action,...dataset}};}}});},async submit(id,fields={},dataset={},submitter={}){await handlers.submit({preventDefault(){},target:{id,fields,dataset},submitter});},get stored(){return stored;}};
}
test('UI: navigates all company pages, shareholder pages and settings without render errors',async()=>{
 const h=harness();await h.start();assert.match(h.nodes['#app'].innerHTML,/Overview/);
 for(const page of ['campaigns','shareholders','treasury','reports','settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.includes('Currenc Connect'));assert.doesNotMatch(h.nodes['#app'].innerHTML,/sandbox/i);assert.doesNotMatch(h.nodes['#app'].innerHTML, /[\u3400-\u9fff]/);}
 await h.click('mode',{mode:'shareholder'});assert.match(h.nodes['#app'].innerHTML,/Companies/);
 for(const page of ['rewards','profile','settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.length>3000);}
});
test('UI: full guided flow persists KYC, holdings, wallet, approval, snapshot and claim',async()=>{
 const h=harness();await h.start();await h.click('mode',{mode:'shareholder'});
 await h.click('join',{id:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/kyc-form/);
 await h.submit('kyc-form',{name:'Demo Investor',email:'demo@example.com',country:'Hong Kong',consent:'on'},{campaign:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/verify-form/);
 await h.submit('verify-form',{shares:'5000',source:'broker'},{id:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/wallet-form/);
 await h.submit('wallet-form',{chain:'BNB',wallet:'0x4444444444444444444444444444444444444444'},{id:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/Awaiting company snapshot/);
 await h.click('mode',{mode:'company'});await h.click('approve',{id:'sample-iris'});
 await h.click('snapshot-preview',{id:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/Lock snapshot/);
 await h.click('snapshot',{id:'curr-welcome'});await h.click('mode',{mode:'shareholder'});
 await h.click('join',{id:'curr-welcome'});assert.match(h.nodes['#dialog'].innerHTML,/500/);
 await h.click('claim',{id:'curr-welcome'});assert.equal(h.stored.transactions.length,1);assert.equal(h.stored.transactions[0].chain,'BNB');
 assert.equal(h.stored.treasury.curr.BNB,24500);assert.match(h.nodes['#app'].innerHTML,/My rewards/);
});
test('UI: untrusted display names are escaped',async()=>{
 const h=harness();await h.start();await h.submit('kyc-form',{name:'<img src=x onerror=alert(1)>',email:'test@example.com',country:'Hong Kong',consent:'on'});
 await h.click('mode',{mode:'shareholder'});assert.ok(!h.nodes['#app'].innerHTML.includes('<img src=x'));assert.match(h.nodes['#app'].innerHTML,/&lt;img/);
});

test('UI: known legacy demo copy is presented in English without changing saved data',async()=>{
 const h=harness();await h.start();
 const legacy=structuredClone(h.stored);
 legacy.campaigns[0].name='\u80a1\u6771\u555f\u822a\u734e\u52f5';
 legacy.holders[0].source='\u793a\u7bc4\u5238\u5546 API';
 legacy.profile.country='\u9999\u6e2f';
 legacy.campaigns.push({...legacy.campaigns[0],id:'custom',name:'Custom campaign'});
 h.context.legacy=legacy;
 const result=vm.runInContext('englishWorkspace(legacy)',h.context);
 assert.equal(result.campaigns[0].name,'Shareholder Welcome Rewards');
 assert.equal(result.holders[0].source,'Demo broker API');
 assert.equal(result.profile.country,'Hong Kong');
 assert.equal(result.activity[0].title,'Workspace ready');
 assert.equal(result.activity[0].detail,'Loaded 3 companies and 4 sample shareholders.');
 assert.equal(result.campaigns.at(-1).name,'Custom campaign');
 assert.equal(legacy.campaigns[0].name,'\u80a1\u6771\u555f\u822a\u734e\u52f5');
});

test('UI: mobile navigation closes after a page is selected',async()=>{
 const h=harness();await h.start();await h.click('menu');
 assert.match(h.nodes['#app'].innerHTML,/sidebar is-open/);
 await h.click('nav',{page:'campaigns'});
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/sidebar is-open/);
});

test('UI: email code login unlocks the workspace; logout removes private state and dialogs',async()=>{
 const h=harness({requiresLogin:true});await h.start();
 assert.match(h.nodes['#app'].innerHTML,/Real shares\./);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/New campaign/);
 await h.click('auth-start');
 assert.match(h.nodes['#app'].innerHTML,/login-email-form/);
 await h.submit('login-email-form',{email:'owner@example.com'});
 assert.match(h.nodes['#app'].innerHTML,/login-code-form/);
 await h.submit('login-code-form',{code:'000000'});
 assert.match(h.nodes['#app'].innerHTML,/Invalid code/);
 await h.submit('login-code-form',{code:'123456'});
 assert.match(h.nodes['#app'].innerHTML,/Account owner/);
 assert.match(h.nodes['#app'].innerHTML,/Sign out/);
 await h.click('create');assert.ok(h.nodes['#dialog'].open);
 await h.click('sign-out');
 assert.match(h.nodes['#app'].innerHTML,/Real shares\./);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Account owner/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/<button\b[^>]*disabled/);
 await h.click('auth-start');
 assert.match(h.nodes['#app'].innerHTML,/Continue with email/);
 assert.equal(h.nodes['#dialog'].innerHTML,'');assert.equal(h.nodes['#dialog'].open,false);
});

test('UI: expired account session closes the workspace rather than showing stale data',async()=>{
 const h=harness({requiresLogin:true});await h.start();
 await h.click('auth-start');
 await h.submit('login-email-form',{email:'owner@example.com'});
 await h.submit('login-code-form',{code:'123456'});
 await h.click('kyc');h.expire();
 await h.submit('kyc-form',{name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:'on'});
 assert.match(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Account owner/);
 assert.equal(h.nodes['#dialog'].innerHTML,'');
});

test('UI: public introduction explains share-based airdrops and preserves invitation context through sign-in navigation',async()=>{
 const h=harness({requiresLogin:true,search:'?email=invited%40example.com&invitation=company-link'});await h.start();
 const landing=h.nodes['#app'].innerHTML;
 assert.match(landing,/real shares you hold/);
 assert.match(landing,/each campaign’s rules determine your token allocation/);
 assert.match(landing,/id="main"/);assert.match(landing,/id="how-it-works"/);
 assert.doesNotMatch(landing,/sandbox|preview|airdrop-illustration/i);
 assert.match(landing,/images\/shareholder-rewards.png/);assert.match(landing,/Current campaigns/);
 assert.doesNotMatch(landing,/demo@example.com|Company workspace|login-email-form/);
 await h.click('auth-start');assert.match(h.nodes['#app'].innerHTML,/value="invited@example.com"/);
 await h.submit('login-email-form',{email:'invited@example.com'});
 assert.match(h.nodes['#app'].innerHTML,/login-code-form/);
 await h.click('auth-back');assert.match(h.nodes['#app'].innerHTML,/value="invited@example.com"/);
 await h.click('auth-home');assert.match(h.nodes['#app'].innerHTML,/Real shares\./);
 await h.click('auth-start');assert.match(h.nodes['#app'].innerHTML,/value="invited@example.com"/);
 assert.equal(vm.runInContext('requestedInvitation',h.context),'company-link');
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Company workspace/);
});

const platformActor=id=>({accountId:id,issuer:'test',user:{name:id,email:id+'@example.com',emailVerified:true}});
function platformHarness(t,actor=platformActor('owner')){const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB);return {DB,platform,actor,...harness({platform,actor,publicDatabase:DB})};}
async function staffCompany(DB,platform,actor,name='Company'){
 await platform.read(actor);await DB.query("INSERT INTO cc_platform_admins (account_id,role,created_at) VALUES ($1,'admin',$2)",[actor.accountId,new Date().toISOString()]);
 const selected=await platform.execute(actor,{type:'platform-create-company',name,ticker:'TST',token:'TEST'});
 await DB.query("DELETE FROM cc_platform_admins WHERE account_id=$1 AND role='admin'",[actor.accountId]);return {view:'company',organizationId:selected.organizationId};
}

test('UI: visitors browse public campaigns and resume their selection after verified login and first onboarding',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB),owner=platformActor('owner');
 const selected=await staffCompany(DB,platform,owner,'<svg onload=alert(1)>');
 await DB.query("UPDATE cc_company_status SET status='approved',visible=1 WHERE organization_id=$1",[selected.organizationId]);
 const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 await platform.execute(owner,{type:'create',organizationId:selected.organizationId,input:{company:selected.organizationId,name:'Welcome <img src=x>',description:'Shareholder rewards',mode:'ratio',ratio:0.1,budget:1000,minimum:10,cap:100,release:100,snapshotDate:today,deadline,distribution:'claim',chains:['ETH']}});
 const id=(await platform.read(owner,selected)).state.campaigns[0].id;await platform.execute(owner,{type:'open',organizationId:selected.organizationId,campaignId:id});
 for(const actor of [owner,platformActor('new-shareholder')]){
  const h=harness({requiresLogin:true,platform,actor,publicDatabase:DB});await h.start();
  assert.match(h.nodes['#app'].innerHTML,/Welcome &lt;img/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<svg onload|<img src=x>/);
  assert.doesNotMatch(h.nodes['#app'].innerHTML,/public-campaign-search|Clear search/);
  assert.match(h.nodes['#app'].innerHTML,/role="region" aria-label="Campaign cards" tabindex="0"/);
  await h.click('public-campaign',{id});assert.match(h.nodes['#dialog'].innerHTML,/Sign in to continue/);
  await h.click('public-start',{id});assert.equal(vm.runInContext('requestedCampaign',h.context),id);
  await h.submit('login-email-form',{email:actor.user.email});await h.submit('login-code-form',{code:'123456'});
  if(actor!==owner){assert.match(h.nodes['#app'].innerHTML,/Continue as a shareholder/);await h.click('onboard-shareholder');}
  assert.equal(vm.runInContext('workspaceContext.mode',h.context),'shareholder');
  assert.match(h.nodes['#dialog'].innerHTML,/Welcome &lt;img/);assert.match(h.nodes['#dialog'].innerHTML,/Register holdings/);
  assert.equal(vm.runInContext('requestedCampaign',h.context),null);
 }
});


test('UI: first-time shareholders onboard without receiving company permissions or sample investors',async t=>{
 const h=platformHarness(t);await h.start();
 assert.match(h.nodes['#app'].innerHTML,/Continue as a shareholder/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Register company|Register a company|Submit for review/);
 await h.click('onboard-shareholder');
 assert.match(h.nodes['#app'].innerHTML,/My rewards/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/data-mode="company"/);
 await h.click('nav',{page:'settings'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/Reset workspace/);
 await h.click('mode',{mode:'company'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/New campaign/);
});

test('UI: company owners create a workspace, manage invitations and safely render company names',async t=>{
 const h=platformHarness(t);const selected=await staffCompany(h.DB,h.platform,h.actor,'<svg onload=alert(1)>');await h.start(selected);
 assert.match(h.nodes['#app'].innerHTML,/&lt;svg/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<svg onload/);
 await h.click('nav',{page:'team'});assert.match(h.nodes['#app'].innerHTML,/Invite member/);
 await h.click('invite-member');assert.match(h.nodes['#dialog'].innerHTML,/No email is sent automatically/);
 await h.submit('invite-form',{email:'colleague@example.com',role:'viewer'});
 assert.match(h.nodes['#app'].innerHTML,/colleague@example.com/);assert.match(h.nodes['#app'].innerHTML,/Copy link/);
 const org=(await h.platform.read(h.actor)).context.organizationId;
 await h.DB.query("UPDATE cc_company_status SET status='approved',visible=1,was_approved=1 WHERE organization_id=$1",[org]);
 const pending=(await h.platform.read(h.actor,{view:'company',organizationId:org})).team.invitations[0];
 await h.click('revoke-invitation',{id:pending.id});assert.doesNotMatch(h.nodes['#app'].innerHTML,/Pending invitations/);
 const today=new Date().toISOString().slice(0,10),deadline=new Date(Date.now()+86400000).toISOString().slice(0,10);
 await h.platform.execute(h.actor,{type:'create',organizationId:org,input:{company:org,name:'Rewards',description:'Test campaign',mode:'ratio',ratio:0.1,budget:1000,minimum:1,cap:1000,release:100,snapshotDate:today,deadline,distribution:'claim',chains:['ETH']}});
 const cid=(await h.platform.read(h.actor,{view:'company',organizationId:org})).state.campaigns[0].id;
 await h.platform.execute(h.actor,{type:'open',organizationId:org,campaignId:cid});
 await h.click('mode',{mode:'shareholder'});
 await h.submit('kyc-form',{name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:'on'});
 await h.click('company-rewards',{company:org});assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/<svg onload/);
 await h.click('join',{id:cid});assert.match(h.nodes['#dialog'].innerHTML,/verify-form/);
 assert.match(h.nodes['#dialog'].innerHTML,/&lt;svg/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/<svg onload/);
});

test('UI: viewers have no campaign, review, funding or team controls; operators retain campaign controls',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB),owner=platformActor('owner');
 const selection=await staffCompany(DB,platform,owner);
 for(const role of ['viewer','operator']){
  const actor=platformActor(role);await platform.read(actor);await platform.execute(owner,{type:'invite-member',organizationId:selection.organizationId,email:actor.user.email,role});
  const invitation=(await platform.read(actor)).access.invitations[0];await platform.execute(actor,{type:'accept-invitation',invitationId:invitation.id});
  const h=harness({platform,actor});await h.start(selection);
  assert.doesNotMatch(h.nodes['#app'].innerHTML,/data-page="team"/);
  if(role==='viewer')assert.doesNotMatch(h.nodes['#app'].innerHTML,/New campaign/);else assert.match(h.nodes['#app'].innerHTML,/New campaign/);
  await h.click('nav',{page:'treasury'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/Add test funds/);
 }
});

test('UI: revoked company membership clears private dialogs and falls back to the shareholder portal',async t=>{
 const h=platformHarness(t);await h.start(await staffCompany(h.DB,h.platform,h.actor,'Private company'));
 const org=(await h.platform.read(h.actor)).context.organizationId,member=platformActor('member');await h.platform.read(member);
 await h.platform.execute(h.actor,{type:'invite-member',organizationId:org,email:member.user.email,role:'admin'});
 const invitation=(await h.platform.read(member)).access.invitations[0];await h.platform.execute(member,{type:'accept-invitation',invitationId:invitation.id});
 const ui=harness({platform:h.platform,actor:member});await ui.start({view:'company',organizationId:org});await ui.click('create');assert.ok(ui.nodes['#dialog'].open);
 await h.platform.execute(h.actor,{type:'remove-member',organizationId:org,memberId:member.accountId});await ui.start();
 assert.equal(ui.nodes['#dialog'].open,false);assert.equal(ui.nodes['#dialog'].innerHTML,'');
 assert.doesNotMatch(ui.nodes['#app'].innerHTML,/Private company|New campaign/);assert.match(ui.nodes['#app'].innerHTML,/Shareholder portal/);
});

test('UI: staff add and edit company information without applications or evidence requirements',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}}),h=harness({platform,actor:root});
 await h.start({view:'platform'});await h.click('platform-new-company');assert.match(h.nodes['#dialog'].innerHTML,/platform-create-company-form/);
 await h.submit('platform-create-company-form',{name:'Managed company',ticker:'APP',token:'TEST'});
 assert.match(h.nodes['#app'].innerHTML,/Company information/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/Submit for review|Applications|Company application/);
 await h.submit('platform-save-company-form',{name:'Managed company',ticker:'APP',legalName:'Test Company',contactName:'<svg onload=bad>'});
 assert.match(h.nodes['#app'].innerHTML,/&lt;svg/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<svg onload/);
 await h.click('mode',{mode:'company'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/company-application|Submit for review/);
 const other=harness({platform,actor:platformActor('ordinary')});await other.start();await other.click('platform-new-company');assert.equal(other.nodes['#dialog'].open,false);
});

test('UI: platform console is restricted, renders admin pages, and safely displays portal settings',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),outsider=platformActor('outsider');
 const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}}),h=harness({platform,actor:root});
 await h.start({view:'platform'});assert.match(h.nodes['#app'].innerHTML,/Platform overview/);
 for(const page of ['platform-companies','platform-accounts','platform-audit','portal-settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.includes('Platform console'));}
 await h.submit('portal-settings-form',{companyApplications:'on',shareholderRegistrations:'on',announcement:'<img src=x onerror=bad>'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/<img src=x/);assert.match(h.nodes['#app'].innerHTML,/&lt;img/);
 const other=harness({platform,actor:outsider});await other.start();assert.doesNotMatch(other.nodes['#app'].innerHTML,/data-mode="platform"/);await other.start({view:'platform'});assert.doesNotMatch(other.nodes['#app'].innerHTML,/Platform overview/);
});

test('UI: suspended accounts clear all cached company data and provide only sign out',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),member=platformActor('member');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});
 await platform.read(root);await staffCompany(DB,platform,member,'Private owned company');
 const h=harness({platform,actor:member});await h.start();await h.click('create');assert.equal(h.nodes['#dialog'].open,true);
 await platform.execute(root,{type:'platform-account-status',accountId:member.accountId,status:'suspended',revision:0,note:'Test suspension.'});await h.start();
 assert.match(h.nodes['#app'].innerHTML,/Account suspended/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/Private owned company|New campaign/);assert.equal(h.nodes['#dialog'].innerHTML,'');assert.equal(h.nodes['#dialog'].open,false);
});

test('UI: campaign editor, reversible deletion and archive expose only stage-appropriate controls',async()=>{
 const h=harness();await h.start();const id='curr-loyalty';await h.click('detail',{id});assert.match(h.nodes['#dialog'].innerHTML,/Edit campaign|Delete draft/);
 await h.click('edit-campaign',{id});assert.match(h.nodes['#dialog'].innerHTML,/Registration deadline \(UTC\)/);assert.match(h.nodes['#dialog'].innerHTML,/Claim deadline \(UTC\)/);
 const c=h.stored.campaigns.find(c=>c.id===id);await h.submit('campaign-editor-form',{name:'Edited loyalty',description:'Edited draft',mode:'ratio',ratio:0.3,budget:10000,minimum:100,cap:1000,release:100,snapshotDate:c.snapshotDate,registrationDeadline:c.deadline,claimDeadline:c.deadline,distribution:'claim',chains:'ETH'},{id});assert.equal(h.stored.campaigns.find(c=>c.id===id).ratio,0.3);
 await h.click('campaign-lifecycle',{id,operation:'delete-draft'});assert.match(h.nodes['#dialog'].innerHTML,/restore it later/);await h.submit('campaign-lifecycle-form',{}, {id,operation:'delete-draft'});assert.equal(h.stored.campaigns.find(c=>c.id===id).status,'deleted');
 await h.click('detail',{id});assert.match(h.nodes['#dialog'].innerHTML,/Restore draft/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Edit campaign|Open registration/);await h.submit('campaign-lifecycle-form',{}, {id,operation:'restore-draft'});
 await h.click('open',{id});assert.match(h.nodes['#app'].innerHTML,/Edited loyalty/);await h.click('edit-campaign',{id});assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/name="budget"|name="chains"|name="release"/);
 await h.click('campaign-lifecycle',{id,operation:'archive-campaign'});await h.submit('campaign-lifecycle-form',{}, {id,operation:'archive-campaign'});assert.equal(h.stored.campaigns.find(c=>c.id===id).status,'archived');await h.click('detail',{id});assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Edit campaign|Delete draft|Restore draft|Open registration/);
});

test('UI: platform company access shows removal, protects owner/self and supports invitation revocation',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),member=platformActor('company-admin'),recipient=platformActor('pending');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);
 const selected=await platform.execute(root,{type:'platform-create-company',name:'Access test',ticker:'TEST',token:'TEST'});await platform.read(member);await platform.read(recipient);await platform.execute(root,{type:'platform-company-admin',organizationId:selected.organizationId,memberEmail:member.user.email,role:'admin'});await platform.execute(root,{type:'invite-member',organizationId:selected.organizationId,email:recipient.user.email,role:'viewer'});
 const h=harness({platform,actor:root});await h.start({view:'platform',organizationId:selected.organizationId});await h.click('platform-company',{id:selected.organizationId});assert.match(h.nodes['#app'].innerHTML,/Company access|platform-company-remove|Pending invitations/);
 await h.click('platform-company-remove',{id:root.accountId});assert.equal(h.nodes['#dialog'].open,false);
 await h.click('platform-company-remove',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/Remove company access/);
 const values={organizationId:selected.organizationId,memberId:member.accountId,expectedRole:'admin'};await h.submit('platform-action-form',{note:'UI test removal.'},{type:'platform-remove-company-member',values:JSON.stringify(values)});assert.doesNotMatch(h.nodes['#app'].innerHTML,/company-admin@example.com/);
 const invitation=(await platform.read(root,{view:'platform',organizationId:selected.organizationId})).platform.company.invitations[0];await h.click('platform-revoke-invitation',{id:invitation.id});assert.match(h.nodes['#dialog'].innerHTML,/Revoke company invitation/);
});

test('UI: shareholder introduction, official network images and contextual help orient new visitors',async()=>{
 const h=harness();await h.start();await h.click('nav',{page:'treasury'});const html=h.nodes['#app'].innerHTML;assert.equal((html.match(/data:image\/svg\+xml;base64,/g)||[]).length,3);assert.doesNotMatch(html,/♦|≋|▧/);
 await h.click('mode',{mode:'shareholder'});assert.match(h.nodes['#app'].innerHTML,/Currenc Connect brings company token rewards to shareholders/);assert.match(h.nodes['#app'].innerHTML,/Choose a company/);assert.match(h.nodes['#app'].innerHTML,/Add a wallet &amp; claim rewards/);
 await h.click('show-info',{title:'Portal announcement',description:'A notice shown at the top of workspace pages.'});assert.match(h.nodes['#dialog'].innerHTML,/Portal announcement/);assert.match(h.nodes['#dialog'].innerHTML,/notice shown/);
});

test('UI: account invitations and removed accounts have clear controls and removed sessions clear private UI',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),member=platformActor('removed-member');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);const selected=await staffCompany(DB,platform,member,'Retained private company');
 const h=harness({platform,actor:root});await h.start({view:'platform'});await h.click('nav',{page:'platform-accounts'});assert.match(h.nodes['#app'].innerHTML,/Add account|Remove portal access/);
 await h.click('platform-add-account');assert.match(h.nodes['#dialog'].innerHTML,/no email is sent automatically/);await h.submit('platform-account-invite-form',{email:'invited@example.com'});assert.match(h.nodes['#app'].innerHTML,/Pending account invitations/);assert.match(h.nodes['#app'].innerHTML,/Copy link/);
 await h.click('nav',{page:'portal-settings'});assert.match(h.nodes['#app'].innerHTML,/Existing rewards and claims continue/);assert.match(h.nodes['#app'].innerHTML,/role="tooltip"/);
 const personal=harness({platform,actor:member});await personal.start(selected);await personal.click('create');assert.equal(personal.nodes['#dialog'].open,true);
 await platform.execute(root,{type:'platform-remove-account',accountId:member.accountId,revision:0,note:'Synthetic removal.'});await personal.start();assert.match(personal.nodes['#app'].innerHTML,/Portal access removed/);assert.doesNotMatch(personal.nodes['#app'].innerHTML,/Retained private company|New campaign/);assert.equal(personal.nodes['#dialog'].innerHTML,'');
 await h.click('platform-account-filter',{filter:'removed'});assert.match(h.nodes['#app'].innerHTML,/Restore access/);
});
