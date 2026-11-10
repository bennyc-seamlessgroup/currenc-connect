// Exercise rendering and event handlers without a browser or external dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {seedState,applyCommand} from '../lib/domain.ts';
import {createPlatform} from '../server/platform.mjs';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
const domain=stripTypeScriptTypes(readFileSync('lib/domain.ts','utf8')).replace(/^export /gm,'');
const app=readFileSync('src/app.js','utf8').replace(/^import[^\n]+\n/,'')+'\n'+readFileSync('src/governance-ui.js','utf8');
function harness({requiresLogin=false,platform=null,actor=null}={}){
 let signedIn=!requiresLogin;
 let stored=seedState();const nodes={};const handlers={};const storage=new Map();
 const node=(id)=>nodes[id] ||= {innerHTML:'',className:'',open:false,value:'',dataset:{},addEventListener(){},classList:{add(){},remove(){}},showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){}};
 const context=vm.createContext({console,crypto,structuredClone,setTimeout:()=>1,clearTimeout(){},Blob,URL,URLSearchParams,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{querySelector:node,addEventListener:(k,v)=>handlers[k]=v,body:{classList:{add(){},remove(){}}}},
  window:{addEventListener(){},scrollTo(){}},
  FormData:class{constructor(f){this.entries=Object.entries(f.fields||{});}*[Symbol.iterator](){yield* this.entries;}getAll(k){return this.entries.filter(([a])=>a===k).map(([,v])=>v);}},
  fetch:async(_url,options)=>{
   if(_url.startsWith('/api/auth')) {
    const action=new URL('https://test.local'+_url).searchParams.get('action');
    const body=JSON.parse(options.body);
    if(action==='verify-code'&&body.code!=='123456')return {ok:false,status:400,json:async()=>({error:'Invalid code'})};
    if(action==='verify-code')signedIn=true;
    if(action==='sign-out')signedIn=false;
    return {ok:true,status:200,json:async()=>({success:true})};
   }
   if(!signedIn)return {ok:false,status:401,json:async()=>({signIn:true,error:'Sign in'})};
   if(platform){try{const url=new URL('https://test.local'+_url);let selection={view:url.searchParams.get('view')||undefined,organizationId:url.searchParams.get('organization')||undefined,page:url.searchParams.get('page'),search:url.searchParams.get('search')};if(options?.method==='POST')selection=await platform.execute(actor,JSON.parse(options.body));const data=await platform.read(actor,selection);return {ok:true,status:200,json:async()=>({...data,user:actor.user})};}catch(error){return {ok:false,status:error.status||500,json:async()=>({error:error.message,code:error.code})};}}
   try{if(options?.method==='POST')stored=applyCommand(stored,JSON.parse(options.body));return{ok:true,status:200,json:async()=>({state:stored,...(requiresLogin?{user:{name:'Account owner',email:'owner@example.com'}}:{})})};}catch(e){return{ok:false,status:422,json:async()=>({error:e.message})};}
  }
 });
 vm.runInContext(domain+'\n'+app+'\n globalThis.ui={load,render,join,createForm,detail,get state(){return state;}}',context);
 return{context,nodes,handlers,expire(){signedIn=false;},async start(selection){await context.ui.load(selection);},async click(action,dataset={}){await handlers.click({preventDefault(){},target:{closest(){return {dataset:{action,...dataset}};}}});},async submit(id,fields={},dataset={},submitter={}){await handlers.submit({preventDefault(){},target:{id,fields,dataset},submitter});},get stored(){return stored;}};
}
test('UI: navigates all company pages, shareholder pages and settings without render errors',async()=>{
 const h=harness();await h.start();assert.match(h.nodes['#app'].innerHTML,/Overview/);
 for(const page of ['campaigns','shareholders','treasury','reports','settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.includes('Sandbox'));assert.doesNotMatch(h.nodes['#app'].innerHTML, /[\u3400-\u9fff]/);}
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
 assert.match(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/New campaign/);
 await h.submit('login-email-form',{email:'owner@example.com'});
 assert.match(h.nodes['#app'].innerHTML,/login-code-form/);
 await h.submit('login-code-form',{code:'000000'});
 assert.match(h.nodes['#app'].innerHTML,/Invalid code/);
 await h.submit('login-code-form',{code:'123456'});
 assert.match(h.nodes['#app'].innerHTML,/Account owner/);
 assert.match(h.nodes['#app'].innerHTML,/Sign out/);
 await h.click('create');assert.ok(h.nodes['#dialog'].open);
 await h.click('sign-out');
 assert.match(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Account owner/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/<button\b[^>]*disabled/);
 assert.match(h.nodes['#app'].innerHTML,/Continue with email/);
 assert.equal(h.nodes['#dialog'].innerHTML,'');assert.equal(h.nodes['#dialog'].open,false);
});

test('UI: expired account session closes the workspace rather than showing stale data',async()=>{
 const h=harness({requiresLogin:true});await h.start();
 await h.submit('login-email-form',{email:'owner@example.com'});
 await h.submit('login-code-form',{code:'123456'});
 await h.click('kyc');h.expire();
 await h.submit('kyc-form',{name:'Demo',email:'demo@example.com',country:'Hong Kong',consent:'on'});
 assert.match(h.nodes['#app'].innerHTML,/login-email-form/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/Account owner/);
 assert.equal(h.nodes['#dialog'].innerHTML,'');
});

const platformActor=id=>({accountId:id,issuer:'test',user:{name:id,email:id+'@example.com',emailVerified:true}});
function platformHarness(t,actor=platformActor('owner')){const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const platform=createPlatform(DB);return {DB,platform,actor,...harness({platform,actor})};}

test('UI: first-time shareholders onboard without receiving company permissions or sample investors',async t=>{
 const h=platformHarness(t);await h.start();
 assert.match(h.nodes['#app'].innerHTML,/Choose how to get started/);
 await h.click('onboard-shareholder');
 assert.match(h.nodes['#app'].innerHTML,/My rewards/);
 assert.doesNotMatch(h.nodes['#app'].innerHTML,/data-mode="company"/);
 await h.click('nav',{page:'settings'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/Reset workspace/);
 await h.click('mode',{mode:'company'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/New campaign/);
});

test('UI: company owners create a workspace, manage invitations and safely render company names',async t=>{
 const h=platformHarness(t);await h.start();await h.click('new-organization');
 assert.match(h.nodes['#app'].innerHTML,/organization-form/);
 await h.submit('organization-form',{name:'<svg onload=alert(1)>',ticker:'TST',token:'TEST'});
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
 await platform.read(owner);const selection=await platform.execute(owner,{type:'create-organization',name:'Company',ticker:'TST',token:'TEST'});
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
 const h=platformHarness(t);await h.start();await h.submit('organization-form',{name:'Private company',ticker:'TST',token:'TEST'});
 const org=(await h.platform.read(h.actor)).context.organizationId,member=platformActor('member');await h.platform.read(member);
 await h.platform.execute(h.actor,{type:'invite-member',organizationId:org,email:member.user.email,role:'admin'});
 const invitation=(await h.platform.read(member)).access.invitations[0];await h.platform.execute(member,{type:'accept-invitation',invitationId:invitation.id});
 const ui=harness({platform:h.platform,actor:member});await ui.start({view:'company',organizationId:org});await ui.click('create');assert.ok(ui.nodes['#dialog'].open);
 await h.platform.execute(h.actor,{type:'remove-member',organizationId:org,memberId:member.accountId});await ui.start();
 assert.equal(ui.nodes['#dialog'].open,false);assert.equal(ui.nodes['#dialog'].innerHTML,'');
 assert.doesNotMatch(ui.nodes['#app'].innerHTML,/Private company|New campaign/);assert.match(ui.nodes['#app'].innerHTML,/Shareholder portal/);
});

test('UI: company registration shows application fields and blocks publishing controls before approval',async t=>{
 const h=platformHarness(t);await h.start();await h.submit('organization-form',{name:'Applicant company',ticker:'APP',token:'TEST'});
 assert.match(h.nodes['#app'].innerHTML,/Company application|company-application-form/);
 assert.match(h.nodes['#app'].innerHTML,/Official website|Representative authority/);
 await h.submit('company-application-form',{legalName:'Test Applicant',contactName:'<svg onload=bad>',authorized:'on'});
 assert.match(h.nodes['#app'].innerHTML,/&lt;svg/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<svg onload/);
 await h.click('nav',{page:'campaigns'});assert.match(h.nodes['#app'].innerHTML,/New campaign/);
 const org=(await h.platform.read(h.actor)).context.organizationId;
 await h.platform.execute(h.actor,{type:'create',organizationId:org,input:{company:org,name:'Draft',description:'Test',mode:'ratio',ratio:0.1,budget:1000,minimum:1,cap:1000,release:100,snapshotDate:new Date().toISOString().slice(0,10),deadline:new Date(Date.now()+86400000).toISOString().slice(0,10),distribution:'claim',chains:['ETH']}});
 await h.start();const id=(await h.platform.read(h.actor)).state.campaigns[0].id;await h.click('detail',{id});assert.doesNotMatch(h.nodes['#dialog'].innerHTML,/Open registration/);
});

test('UI: platform console is restricted, renders admin pages, and safely displays portal settings',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),outsider=platformActor('outsider');
 const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}}),h=harness({platform,actor:root});
 await h.start({view:'platform'});assert.match(h.nodes['#app'].innerHTML,/Platform overview/);
 for(const page of ['platform-applications','platform-companies','platform-accounts','platform-audit','portal-settings']){await h.click('nav',{page});assert.ok(h.nodes['#app'].innerHTML.includes('Platform console'));}
 await h.submit('portal-settings-form',{companyApplications:'on',shareholderRegistrations:'on',announcement:'<img src=x onerror=bad>'});assert.doesNotMatch(h.nodes['#app'].innerHTML,/<img src=x/);assert.match(h.nodes['#app'].innerHTML,/&lt;img/);
 const other=harness({platform,actor:outsider});await other.start();assert.doesNotMatch(other.nodes['#app'].innerHTML,/data-mode="platform"/);await other.start({view:'platform'});assert.doesNotMatch(other.nodes['#app'].innerHTML,/Platform overview/);
});

test('UI: suspended accounts clear all cached company data and provide only sign out',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const root=platformActor('platform-root'),member=platformActor('member');const platform=createPlatform(DB,{bootstrapOwner:{email:root.user.email,issuer:'test'}});
 await platform.read(root);await platform.read(member);await platform.execute(member,{type:'create-organization',name:'Private owned company',ticker:'PRIV',token:'TEST'});
 const h=harness({platform,actor:member});await h.start();await h.click('create');assert.equal(h.nodes['#dialog'].open,true);
 await platform.execute(root,{type:'platform-account-status',accountId:member.accountId,status:'suspended',revision:0,note:'Test suspension.'});await h.start();
 assert.match(h.nodes['#app'].innerHTML,/Account suspended/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/Private owned company|New campaign/);assert.equal(h.nodes['#dialog'].innerHTML,'');assert.equal(h.nodes['#dialog'].open,false);
});
