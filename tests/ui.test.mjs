// Exercise rendering and event handlers without a browser or external dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {seedState,applyCommand} from '../lib/domain.ts';
const domain=stripTypeScriptTypes(readFileSync('lib/domain.ts','utf8')).replace(/^export /gm,'');
const app=readFileSync('src/app.js','utf8').replace(/^import[^\n]+\n/,'');
function harness(){
 let stored=seedState();const nodes={};const handlers={};const storage=new Map();
 const node=(id)=>nodes[id] ||= {innerHTML:'',className:'',open:false,value:'',dataset:{},addEventListener(){},classList:{add(){},remove(){}},showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){}};
 const context=vm.createContext({console,crypto,structuredClone,setTimeout:()=>1,clearTimeout(){},Blob,URL,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{querySelector:node,addEventListener:(k,v)=>handlers[k]=v,body:{classList:{add(){},remove(){}}}},
  window:{addEventListener(){},scrollTo(){}},
  FormData:class{constructor(f){this.entries=Object.entries(f.fields||{});}*[Symbol.iterator](){yield* this.entries;}getAll(k){return this.entries.filter(([a])=>a===k).map(([,v])=>v);}},
  fetch:async(_url,options)=>{try{if(options?.method==='POST')stored=applyCommand(stored,JSON.parse(options.body));return{ok:true,json:async()=>({state:stored})};}catch(e){return{ok:false,json:async()=>({error:e.message})};}}
 });
 vm.runInContext(domain+'\n'+app+'\n globalThis.ui={load,render,join,createForm,detail,get state(){return state;}}',context);
 return{context,nodes,handlers,async start(){await context.ui.load();},async click(action,dataset={}){await handlers.click({preventDefault(){},target:{closest(){return {dataset:{action,...dataset}};}}});},async submit(id,fields={},dataset={}){await handlers.submit({preventDefault(){},target:{id,fields,dataset}});},get stored(){return stored;}};
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
