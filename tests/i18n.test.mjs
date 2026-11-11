import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {prepareUI,localeSource} from '../scripts/ui-source.mjs';
const translations=JSON.parse(readFileSync('src/locales/zh-Hant.json','utf8'));
function context(language='en'){
 const storage=new Map([['cc-language',language]]),document={documentElement:{},querySelectorAll:()=>[]};const c=vm.createContext({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document,$:()=>({open:false}),render(){}});vm.runInContext(localeSource(),c);return {c,document,storage};
}
test('language: English default, saved Traditional Chinese and document metadata',()=>{
 const first=context();assert.equal(first.c.tr('Token custody'),'Token custody');const saved=context('zh-Hant');assert.equal(saved.c.tr('Token custody'),'代幣代管');assert.equal(saved.c.tr('Needs changes'),'待修正');saved.c.applyLanguageMetadata();assert.equal(saved.document.documentElement.lang,'zh-Hant');saved.c.setLanguage('en');assert.equal(saved.storage.get('cc-language'),'en');assert.equal(saved.c.tr('Token custody'),'Token custody');
});
test('language: source templates translate labels and accessible attributes while preserving user content and canonical form values',()=>{
 const {c}=context('zh-Hant');const source="function fixture(name,token,address){return `<h2>${name}</h2><p>Token source</p><p>${token}</p><input name=\"wallet\" value=\"${address}\" placeholder=\"Public wallet address\"><select name=\"fundingSource\"><option value=\"custody\">Platform custody</option><option value=\"company_wallet\">Company wallet</option></select>`;}";vm.runInContext(prepareUI(source,{translations}),c);
 const html=c.fixture('Token custody','Open','0x1111111111111111111111111111111111111111');assert.match(html,/<h2>Token custody<\/h2>/);assert.match(html,/<p>代幣來源<\/p>/);assert.match(html,/<p>Open<\/p>/);assert.match(html,/value="company_wallet">公司自有錢包/);assert.match(html,/value="custody">平台代管/);assert.match(html,/placeholder="公開錢包地址"/);assert.match(html,/name="wallet" value="0x111111/);
});
test('language: translating dynamic text does not change access codes, payloads or asset metadata',()=>{
 const {c}=context('zh-Hant');const source="function fixture(flag){const role=flag?`admin`:`viewer`;const input={type:'create',fundingSource:`company_wallet`,network:'ethereum',symbol:`Open`};return {role,input,html:`<p>Per share: ${12} ${input.symbol}</p>`};}";vm.runInContext(prepareUI(source,{translations}),c);const r=c.fixture(true);assert.equal(r.role,'admin');assert.equal(r.input.type,'create');assert.equal(r.input.fundingSource,'company_wallet');assert.equal(r.input.network,'ethereum');assert.equal(r.input.symbol,'Open');assert.equal(r.html,'<p>每股：12 Open</p>');
});
test('language: placeholders reorder without reprocessing inserted strings, and error details are localized',()=>{
 const {c}=context('zh-Hant');vm.runInContext("function fixture(address){return i18nHtml`<p>${address} shares</p>`;}",c);assert.equal(c.fixture('__CC_SLOT_1__'),'<p>__CC_SLOT_1__ 股</p>');assert.equal(c.tr('CSV row 2: Duplicate wallet address. Combine amounts into one row.'),'CSV 第 2 行：錢包地址重複，請將數量合併為一行。');assert.equal(c.tr('Token amounts support at most 6 decimal places.'),'此代幣數量最多支援 6 位小數。');
});
test('language: catalog preserves every interpolation parameter',()=>{
 for(const [english,chinese]of Object.entries(translations)){const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();assert.deepEqual(slots(chinese),slots(english),english);}
});
