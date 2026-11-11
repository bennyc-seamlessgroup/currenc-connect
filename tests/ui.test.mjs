// Exercise rendering and event handlers without a browser or external dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {readUI,localeSource} from '../scripts/ui-source.mjs';
import {seedState,applyCommand} from '../lib/domain.ts';
import {createPlatform} from '../server/platform.mjs';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createWallets} from '../server/wallets.mjs';
import {testSigner} from './helpers/wallets.mjs';
import {readPublicCampaigns} from '../server/public-campaigns.mjs';
import {createManagedAirdrops} from '../server/managed-airdrops.mjs';
import {createTestnet} from '../server/testnet.mjs';
const domain=stripTypeScriptTypes(readFileSync('lib/domain.ts','utf8')).replace(/^export /gm,'');
const chainLogos=Object.fromEntries([['ETH','ethereum'],['SOL','solana'],['BNB','bnb']].map(([chain,file])=>[chain,'data:image/svg+xml;base64,'+readFileSync(`src/assets/chains/${file}.svg`).toString('base64')]));
const translations=JSON.parse(readFileSync('src/locales/zh-Hant.json','utf8'));
const app=localeSource()+'\nconst brandSymbol='+JSON.stringify(readFileSync('src/assets/brand/symbol.svg','utf8'))+';\nconst chainLogoData='+JSON.stringify(chainLogos)+';\n'+readUI(translations);
function harness({requiresLogin=false,platform=null,actor=null,search='',publicRows=[],publicDatabase=null,walletService=null,testnetService=null,managedService=null,language='en'}={}){
 let signedIn=!requiresLogin;
 let stored=seedState();const nodes={};const handlers={};const storage=new Map([['cc-language',language]]);
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
   if(_url==='/api/managed-airdrops'&&managedService){try{const input=JSON.parse(options.body),method=['create','detail','walletSave','assetSave'].includes(input.action)?input.action:'mutate',data=await managedService[method](actor,input);return{ok:true,status:200,json:async()=>data};}catch(error){return{ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   if(_url==='/api/testnet'&&testnetService){try{const input=JSON.parse(options.body),data=await testnetService[input.action](actor,input);return{ok:true,status:200,json:async()=>data};}catch(error){return{ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   if(_url==='/api/wallets'&&walletService){try{const input=JSON.parse(options.body),identity={...actor,sessionHash:'ui-test-wallet-session-binding'},data=input.action==='challenge'?{challenge:await walletService.challenge(identity,'https://test.local',input)}:input.action==='verify'?{wallet:await walletService.verify(identity,'https://test.local',input)}:await walletService.remove(identity,input);return {ok:true,status:200,json:async()=>data};}catch(error){return{ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   if(platform){try{const url=new URL('https://test.local'+_url);let selection={view:url.searchParams.get('view')||undefined,organizationId:url.searchParams.get('organization')||undefined,page:url.searchParams.get('page'),search:url.searchParams.get('search'),accountFilter:url.searchParams.get('accounts')};if(options?.method==='POST')selection=await platform.execute(actor,JSON.parse(options.body));const data=await platform.read(actor,selection);return {ok:true,status:200,json:async()=>({...data,user:actor.user})};}catch(error){return {ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   try{if(options?.method==='POST')stored=applyCommand(stored,JSON.parse(options.body));return{ok:true,status:200,json:async()=>({state:stored,...(requiresLogin?{user:{name:'Account owner',email:'owner@example.com'}}:{})})};}catch(e){return{ok:false,status:422,json:async()=>({error:e.message})};}
  }
 });
 vm.runInContext(domain+'\n'+app+'\n globalThis.ui={load,loadPublicCampaigns,render,join,createForm,detail,get state(){return state;}}',context);
 return{context,nodes,handlers,expire(){signedIn=false;},async start(selection){await context.ui.load(selection);await context.ui.loadPublicCampaigns();},async click(action,dataset={}){await handlers.click({preventDefault(){},target:{closest(){return {dataset:{action,...dataset}};}}});},async submit(id,fields={},dataset={},submitter={}){await handlers.submit({preventDefault(){},target:{id,fields,dataset},submitter});},get stored(){return stored;}};
}
test('UI: navigates all company pages, shareholder pages and settings without render errors',async()=>{
 const h=harness();await h.start();assert.match(h.nodes['#app'].innerHTML,/Overview/);
 for(const page of ['campaigns','shareholders','treasury','reports','settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.includes('Currenc Connect'));assert.doesNotMatch(h.nodes['#app'].innerHTML,/sandbox/i);assert.doesNotMatch(h.nodes['#app'].innerHTML.replaceAll('繁體中文',''), /[\u3400-\u9fff]/);}
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
 await h.click('join',{id:cid});assert.match(h.nodes['#dialog'].innerHTML,/holding-upload-form/);
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
 assert.match(h.nodes['#app'].innerHTML,/Portal access disabled/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/Private owned company|New campaign/);assert.equal(h.nodes['#dialog'].innerHTML,'');assert.equal(h.nodes['#dialog'].open,false);
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
 const h=harness({platform,actor:root});await h.start({view:'platform'});await h.click('nav',{page:'platform-accounts'});assert.match(h.nodes['#app'].innerHTML,/Manage access/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/data-action="platform-remove-account"/);
 await h.click('account-manage-access',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/Company roles/);assert.match(h.nodes['#dialog'].innerHTML,/account-access-controls/);
 await h.click('platform-remove-account',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/including shareholder sign-in/);assert.match(h.nodes['#dialog'].innerHTML,/Revoke platform role or Remove company access/);assert.match(h.nodes['#dialog'].innerHTML,/type="submit">Disable all portal access/);await h.click('close');assert.equal((await platform.read(member,selected)).context.role,'owner');
 await h.click('platform-add-account');assert.match(h.nodes['#dialog'].innerHTML,/no email is sent automatically/);await h.submit('platform-account-invite-form',{email:'invited@example.com'});assert.match(h.nodes['#app'].innerHTML,/Pending account invitations/);assert.match(h.nodes['#app'].innerHTML,/Copy link/);
 await h.click('nav',{page:'portal-settings'});assert.match(h.nodes['#app'].innerHTML,/Existing rewards and claims continue/);assert.match(h.nodes['#app'].innerHTML,/role="tooltip"/);
 const personal=harness({platform,actor:member});await personal.start(selected);await personal.click('create');assert.equal(personal.nodes['#dialog'].open,true);
 await platform.execute(root,{type:'platform-remove-account',accountId:member.accountId,revision:0,note:'Synthetic removal.'});await personal.start();assert.match(personal.nodes['#app'].innerHTML,/Portal access disabled/);assert.doesNotMatch(personal.nodes['#app'].innerHTML,/Retained private company|New campaign/);assert.equal(personal.nodes['#dialog'].innerHTML,'');
 await h.click('platform-account-filter',{filter:'removed'});await h.click('account-manage-access',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/Restore portal access/);
 await h.click('platform-restore-account',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/all retained company roles/);assert.match(h.nodes['#dialog'].innerHTML,/remove any retained company roles before restoring/);await assert.rejects(platform.read(member),e=>e.code==='ACCOUNT_REMOVED');
});

test('UI: Manage access keeps account actions out of the list and revokes company/platform roles independently',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('role-root'),member=platformActor('role-member');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);await platform.read(member);
 const first=await platform.execute(root,{type:'platform-create-company',name:'Company <img src=x>',ticker:'ROLEA',token:'TEST'}),second=await platform.execute(root,{type:'platform-create-company',name:'Other company',ticker:'ROLEB',token:'TEST'});
 for(const [selection,role] of [[first,'admin'],[second,'viewer']])await platform.execute(root,{type:'platform-company-admin',organizationId:selection.organizationId,memberEmail:member.user.email,role});
 await platform.execute(root,{type:'platform-admin-access',accountId:member.accountId,grant:true});await platform.execute(member,{type:'kyc',name:'Personal identity retained',email:'member@example.test',country:'Hong Kong',consent:true});
 const h=harness({platform,actor:root});await h.start({view:'platform'});await h.click('nav',{page:'platform-accounts'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/data-action="platform-(?:account|remove-account|admin)"/);
 await h.click('account-manage-access',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/Company &lt;img src=x&gt;/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/<img src=x>/);assert.match(h.nodes['#dialog'].innerHTML,/Other company/);
 await h.click('account-company-edit',{id:member.accountId,organization:first.organizationId});assert.match(h.nodes['#dialog'].innerHTML,/account-company-role-form/);
 await h.submit('account-company-role-form',{role:'operator'},{id:member.accountId,organization:first.organizationId,role:'admin'});assert.equal((await platform.read(member,{view:'company',organizationId:first.organizationId})).context.role,'operator');
 await h.click('account-manage-access',{id:member.accountId});await h.click('account-company-remove',{id:member.accountId,organization:first.organizationId});assert.match(h.nodes['#dialog'].innerHTML,/Shareholder sign-in, personal rewards and other company roles remain available/);
 await h.submit('platform-action-form',{note:'Synthetic scoped company removal.'},{type:'platform-remove-company-member',values:JSON.stringify({organizationId:first.organizationId,memberId:member.accountId,expectedRole:'operator'})});
 assert.equal((await platform.read(member,{view:'company',organizationId:second.organizationId})).context.role,'viewer');await assert.rejects(platform.read(member,{view:'company',organizationId:first.organizationId}),e=>e.status===403);
 await h.click('account-manage-access',{id:member.accountId});assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Company &lt;img/);await h.click('platform-admin',{id:member.accountId});
 await h.submit('platform-action-form',{note:'Synthetic platform role revocation.'},{type:'platform-admin-access',values:JSON.stringify({accountId:member.accountId,grant:false})});
 const personal=await platform.read(member,{view:'shareholder'});assert.equal(personal.state.profile.name,'Personal identity retained');assert.equal(personal.access.platformRole,null);assert.equal(personal.access.organizations.length,1);assert.equal(personal.access.organizations[0].id,second.organizationId);
});

test('UI: searches identity fields, distinguishes login email and exposes only unified disabled recovery',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('identity-root'),member=platformActor('identity-member');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);await platform.read(member);
 await platform.execute(member,{type:'kyc',name:'Profile <img src=x>',email:'self-reported@example.test',country:'Singapore',consent:true});
 const h=harness({platform,actor:root});await h.start({view:'platform'});await h.click('nav',{page:'platform-accounts'});assert.match(h.nodes['#app'].innerHTML,/Search name, email or country/);
 await h.submit('platform-search-form',{search:'Singapore'});assert.match(h.nodes['#app'].innerHTML,/Profile &lt;img src=x&gt;/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<img src=x>/);assert.match(h.nodes['#app'].innerHTML,/identity-member@example.com/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/self-reported@example.test/);
 await h.click('account-manage-access',{id:member.accountId});const dialog=h.nodes['#dialog'].innerHTML;assert.match(dialog,/Identity profile/);assert.match(dialog,/self-reported@example.test/);assert.match(dialog,/Completed \(demo\)/);assert.match(dialog,/Third-party KYC is not connected/);assert.doesNotMatch(dialog,/Suspend all|Resume portal|Verified KYC/);
 await h.click('close');await DB.query("INSERT INTO cc_account_controls (account_id,status,archived,revision,updated_at) VALUES ($1,'suspended',0,3,$2)",[member.accountId,new Date().toISOString()]);
 await h.click('platform-account-filter',{filter:'removed'});assert.match(h.nodes['#app'].innerHTML,/Profile &lt;img src=x&gt;/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/Manage access for identity-root@example.com/);await h.click('account-manage-access',{id:member.accountId});assert.match(h.nodes['#dialog'].innerHTML,/Restore portal access/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Suspend all|Resume portal|data-action="platform-remove-account"/);
 await h.click('platform-restore-account',{id:member.accountId});await h.submit('platform-action-form',{note:'Explicit synthetic legacy recovery.'},{type:'platform-restore-account',values:JSON.stringify({accountId:member.accountId,revision:3})});assert.equal((await platform.read(member,{view:'shareholder'})).state.profile.name,'Profile <img src=x>');
});

test('UI: a wallet can be verified before KYC and is never signed without the explicit Sign message action',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB),actor=platformActor('wallet-only');await platform.read(actor);await platform.execute(actor,{type:'onboard'});const walletService=createWallets(DB,platform),h=harness({platform,actor,walletService}),signer=testSigner();let signed=0;
 h.context.walletTestRuntime={discover:()=>[{id:'qa-wallet',name:'QA <img src=x>'}],async connect(){return{address:signer.address,release(){},assertActive:async()=>{},sign:message=>{signed++;return signer.sign(message);}};}};vm.runInContext('walletRuntimePromise=Promise.resolve({walletRuntime:walletTestRuntime})',h.context);
 await h.start({view:'shareholder'});await h.click('nav',{page:'profile'});assert.match(h.nodes['#app'].innerHTML,/Connect wallet/);assert.equal(h.context.ui.state.profile.kyc,false);await h.click('wallet-start');assert.match(h.nodes['#dialog'].innerHTML,/QA &lt;img src=x&gt;/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/<img src=x>/);
 await h.click('wallet-connect',{provider:'qa-wallet'});assert.match(h.nodes['#dialog'].innerHTML,/Verify wallet control/);assert.equal(signed,0);await h.click('wallet-sign');assert.equal(signed,1);assert.equal((await walletService.list({...actor,sessionHash:'ui-test-wallet-session-binding'})).length,1);assert.equal(h.context.ui.state.profile.kyc,false);assert.equal(h.context.ui.state.holders.length,0);assert.match(h.nodes['#app'].innerHTML,/Receiving wallets/);
 await h.click('sign-out');assert.equal(h.context.ui.state,null);assert.equal(h.nodes['#dialog'].innerHTML,'');assert.doesNotMatch(h.nodes['#app'].innerHTML,new RegExp(signer.address));
});
test('UI: closing the wallet connection dialog ignores late provider results',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB),actor=platformActor('wallet-cancel');await platform.read(actor);await platform.execute(actor,{type:'onboard'});const walletService=createWallets(DB,platform),h=harness({platform,actor,walletService}),signer=testSigner();let resolve,released=0;
 h.context.walletTestRuntime={discover:()=>[{id:'qa',name:'QA Wallet'}],connect:()=>new Promise(r=>resolve=r)};vm.runInContext('walletRuntimePromise=Promise.resolve({walletRuntime:walletTestRuntime})',h.context);await h.start({view:'shareholder'});await h.click('wallet-start');const running=h.click('wallet-connect',{provider:'qa'});while(!resolve)await Promise.resolve();await h.click('close');resolve({address:signer.address,release(){released++;},assertActive:async()=>{},sign:message=>signer.sign(message)});await running;assert.equal(released,1);assert.equal(h.nodes['#dialog'].open,false);assert.equal((await DB.query('SELECT id FROM cc_wallet_challenges')).length,0);
});

async function testnetUiFixture(t,{delayed=false}={}){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const actor=platformActor('testnet-ui-owner'),platform=createPlatform(DB),selection=await staffCompany(DB,platform,actor,'Private test company'),wallets=createWallets(DB,platform),signer=testSigner(),identity={...actor,sessionHash:'testnet-ui-session-binding'};
 await DB.query("INSERT INTO cc_platform_admins (account_id,role,created_at) VALUES ($1,'admin',$2)",[actor.accountId,new Date().toISOString()]);
 const challenge=await wallets.challenge(identity,'https://test.local',{chain:'ETH',address:signer.address}),verified=await wallets.verify(identity,'https://test.local',{challengeId:challenge.id,signature:await signer.sign(challenge.message)}),service=createTestnet(DB,platform,{client:{getChainId:async()=>11155111}}),pilot=await service.pilot(actor,{organizationId:selection.organizationId,name:'Pilot <img src=x>',amount:100,walletId:verified.id,walletRevision:0,testDataConsent:true});
 let resolve,sendCount=0,recorded=[],statusOverride;
 const fake={status:(actor,input)=>statusOverride||service.status(actor,input),prepare:async(actor,input)=>{const tx=await service.prepare(actor,input);return delayed?new Promise(r=>resolve=()=>r(tx)):tx;},submit:async(_actor,input)=>{recorded.push(input.hash);return{};}};
 const h=harness({platform,actor,testnetService:fake});h.context.walletTestRuntime={discover:()=>[{id:'qa',name:'QA <img src=x>'}],connectTestnet:async()=>({address:signer.address,release(){},sendTestnet:async()=>{sendCount++;return '0x'+'a'.repeat(64);}})};vm.runInContext('walletRuntimePromise=Promise.resolve({walletRuntime:walletTestRuntime})',h.context);
 await h.start(selection);return {...h,pilot,verified,DB,get sends(){return sendCount;},get recorded(){return recorded;},get resolve(){return resolve;},setStatus(value){statusOverride=value;}};
}
test('UI: testnet transactions require a separate confirmation and show amount, wallet and network before sending',async t=>{
 const h=await testnetUiFixture(t);await h.click('nav',{page:'campaigns'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/New testnet pilot|testnet-pilot/);await h.click('nav',{page:'settings'});assert.match(h.nodes['#app'].innerHTML,/Internal test tools/);assert.match(h.nodes['#app'].innerHTML,/Create Sepolia test/);
 await h.click('testnet-prepare-deploy',{id:h.pilot.campaignId});await h.submit('testnet-prepare-form',{walletId:h.verified.id},{id:h.pilot.campaignId,kind:'deploy'});assert.equal(h.sends,0);assert.match(h.nodes['#dialog'].innerHTML,/QA &lt;img/);
 await h.click('testnet-connect',{provider:'qa'});const preview=h.nodes['#dialog'].innerHTML;assert.match(preview,/Maximum test supply/);assert.match(preview,/100 TEST/);assert.match(preview,/Ethereum Sepolia/);assert.match(preview,/Pilot &lt;img/);assert.equal(h.sends,0);
 await h.click('testnet-send');assert.equal(h.sends,1);assert.equal(h.recorded.length,1);
});
test('UI: closing a pending testnet preparation ignores its late response and clears unsigned transaction state',async t=>{
 const h=await testnetUiFixture(t,{delayed:true});await h.click('testnet-prepare-deploy',{id:h.pilot.campaignId});const pending=h.submit('testnet-prepare-form',{walletId:h.verified.id},{id:h.pilot.campaignId,kind:'deploy'});while(!h.resolve)await Promise.resolve();await h.click('close');h.resolve();await pending;
 assert.equal(h.nodes['#dialog'].open,false);assert.equal(h.sends,0);assert.equal(vm.runInContext('testnetPending',h.context),null);
});
test('UI: a pending testnet claim shows status recovery instead of another send action',async t=>{
 const h=await testnetUiFixture(t);h.setStatus({contract:'0x'+'1'.repeat(40),paused:false,deployment:{id:'deployment',kind:'deploy',status:'confirmed'},transactions:[{id:'pending-claim',kind:'claim',status:'included',hash:'0x'+'b'.repeat(64),own:true}]});await h.click('mode',{mode:'shareholder'});await h.click('testnet-open',{id:h.pilot.campaignId});
 assert.match(h.nodes['#dialog'].innerHTML,/Included · awaiting finality/);assert.match(h.nodes['#dialog'].innerHTML,/Check status/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Claim test tokens/);
});

test('UI: wallet list setup guides managers through exact review and submission without recipient login',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('managed-ui-staff'),admin=platformActor('managed-ui-admin'),platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});await platform.read(root);await platform.read(admin);await platform.execute(admin,{type:'onboard'});
 const selected=await platform.execute(root,{type:'platform-create-company',name:'Wallet company <img src=x>',ticker:'WAL',token:'TEST'});await platform.execute(root,{type:'platform-company-admin',organizationId:selected.organizationId,memberEmail:admin.user.email,role:'admin'});
 const managedService=createManagedAirdrops(DB,platform),h=harness({platform,actor:admin,managedService});await h.start({view:'company',organizationId:selected.organizationId});await h.click('nav',{page:'campaigns'});assert.match(h.nodes['#app'].innerHTML,/Campaign setup guide/);
 await h.click('create');assert.match(h.nodes['#dialog'].innerHTML,/Wallet list airdrop/);await h.click('managed-new');assert.match(h.nodes['#dialog'].innerHTML,/Token contract \/ mint address/);assert.match(h.nodes['#dialog'].innerHTML,/role="tooltip"/);const beforeHelp=h.nodes['#dialog'].innerHTML,help=beforeHelp.match(/data-tip="([^"]+)"/)[1];h.nodes['#'+help]={hidden:true};await h.click('campaign-field-help',{tip:help});assert.equal(h.nodes['#'+help].hidden,false);assert.equal(h.nodes['#dialog'].innerHTML,beforeHelp);
 await h.submit('managed-info-form',{name:'Airdrop <svg onload=alert(1)>',purpose:'Company reward',network:'ethereum',tokenAddress:'0x3333333333333333333333333333333333333333',symbol:'TEST',decimals:'6',scheduledAt:new Date(Date.now()+7*86400000).toISOString().slice(0,16)});
 assert.match(h.nodes['#dialog'].innerHTML,/Upload your recipient list to continue/);assert.match(h.nodes['#dialog'].innerHTML,/No portal sign-in, KYC or wallet connection required/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/<svg onload/);
 let row=(await platform.read(admin,{view:'company',organizationId:selected.organizationId})).managed.campaigns[0];await h.handlers.submit({preventDefault(){},target:{id:'managed-import-form',fields:{},dataset:{id:row.id},elements:{file:{files:[{size:140,text:async()=> 'wallet_address,amount,reference\n0x1111111111111111111111111111111111111111,123.000001,<img src=x>'}]}}}});await h.click('managed-open',{id:row.id});assert.match(h.nodes['#dialog'].innerHTML,/123.000001/);assert.match(h.nodes['#dialog'].innerHTML,/&lt;img src=x&gt;/);
 await h.click('managed-review-submit');assert.match(h.nodes['#dialog'].innerHTML,/does not transfer tokens or reserve funds/);await h.submit('managed-submit-form',{confirm:'on'});
 assert.match(h.nodes['#dialog'].innerHTML,/In review/);assert.match(h.nodes['#dialog'].innerHTML,/version 1/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/managed-import-form/);assert.equal((await platform.read(admin,{view:'shareholder'})).state.profile.kyc,false);
 const internal=harness({platform,actor:root,managedService});await internal.start({view:'platform'});await internal.click('nav',{page:'custody'});assert.match(internal.nodes['#app'].innerHTML,/Release queue/);assert.match(internal.nodes['#app'].innerHTML,/Airdrop &lt;svg/);await internal.click('managed-open',{id:row.id});await internal.click('managed-review-plan');assert.match(internal.nodes['#dialog'].innerHTML,/does not sign a transaction/);await internal.submit('managed-review-form',{note:'Checked instructions.'},{},{value:'approve'});assert.match(internal.nodes['#dialog'].innerHTML,/Release · custody setup required/);
 await h.click('managed-open',{id:row.id});assert.match(h.nodes['#dialog'].innerHTML,/Plan approved/);assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/managed-ui-staff/);await h.click('nav',{page:'team'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/managed-ui-staff/);
});

test('UI: closing a pending managed-airdrop request prevents private results from reopening',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('managed-late'),platform=createPlatform(DB),selected=await staffCompany(DB,platform,root);let resolve;
 const managedService={detail:()=>new Promise(r=>resolve=r)},h=harness({platform,actor:root,managedService});await h.start(selected);const pending=h.click('managed-open',{id:'pending'});while(!resolve)await Promise.resolve();await h.click('close');resolve({campaign:{name:'Late private campaign'}});await pending;assert.equal(h.nodes['#dialog'].open,false);
});

test('UI: Traditional Chinese switches without changing company data, then returns to English',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const actor=platformActor('language-admin'),platform=createPlatform(DB),selected=await staffCompany(DB,platform,actor,'Campaigns'),h=harness({platform,actor,language:'zh-Hant',managedService:createManagedAirdrops(DB,platform)});
 await h.start(selected);assert.match(h.nodes['#app'].innerHTML,/總覽/);assert.match(h.nodes['#app'].innerHTML,/>Campaigns<\/option>/);await h.click('nav',{page:'campaigns'});assert.match(h.nodes['#app'].innerHTML,/錢包名單空投/);assert.match(h.nodes['#app'].innerHTML,/股東獎勵/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/New testnet pilot/);
 await h.click('create');assert.match(h.nodes['#dialog'].innerHTML,/錢包名單空投/);await h.click('managed-new');assert.match(h.nodes['#dialog'].innerHTML,/代幣來源/);assert.match(h.nodes['#dialog'].innerHTML,/value="custody"[^>]*>平台代管/);assert.match(h.nodes['#dialog'].innerHTML,/value="company_wallet"[^>]*>公司自有錢包/);
 await h.submit('managed-info-form',{name:'New campaign',purpose:'Do not translate this description.',network:'ethereum',fundingSource:'company_wallet',tokenAddress:'0x3333333333333333333333333333333333333333',symbol:'Open',decimals:'6',scheduledAt:new Date(Date.now()+7*86400000).toISOString().slice(0,16)});
 assert.match(h.nodes['#dialog'].innerHTML,/<h2>New campaign<\/h2>/);assert.match(h.nodes['#dialog'].innerHTML,/Do not translate this description\./);assert.match(h.nodes['#dialog'].innerHTML,/公司自有錢包/);const record=(await platform.read(actor,selected)).managed.campaigns[0];assert.equal(record.name,'New campaign');assert.equal(record.symbol,'Open');assert.equal(record.fundingSource,'company_wallet');
 await h.click('close');vm.runInContext("setLanguage('en')",h.context);assert.match(h.nodes['#app'].innerHTML,/>Campaigns<\/h1>/);assert.match(h.nodes['#app'].innerHTML,/Wallet list airdrops/);assert.equal(vm.runInContext("localStorage.getItem('cc-language')",h.context),'en');
});

test('UI: Chinese sign-in preserves email identity and language is selectable before login',async()=>{
 const h=harness({requiresLogin:true,language:'zh-Hant'});await h.start();assert.match(h.nodes['#app'].innerHTML,/真實持股/);assert.match(h.nodes['#app'].innerHTML,/data-language-switch/);await h.click('auth-start');assert.match(h.nodes['#app'].innerHTML,/電郵地址/);await h.submit('login-email-form',{email:'language@example.test'});assert.match(h.nodes['#app'].innerHTML,/language@example.test/);assert.match(h.nodes['#app'].innerHTML,/驗證碼/);assert.match(h.nodes['#app'].innerHTML,/id="login-code" name="code"/);
});
