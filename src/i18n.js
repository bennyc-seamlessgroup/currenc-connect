let uiLanguage=localStorage.getItem('cc-language')==='zh-Hant'?'zh-Hant':'en';
const uiLocale=()=>uiLanguage==='zh-Hant'?'zh-HK':'en-GB';
const languageName=()=>uiLanguage==='zh-Hant'?'繁體中文':'English';
const canonicalText=s=>String(s).trim().replace(/\s+/g,' ');
function tr(value){
 const text=String(value??'');if(uiLanguage==='en')return text;
 const key=canonicalText(text),translated=ZH_HANT[key];if(translated!==undefined)return text.replace(text.trim(),translated);
 const csv=key.match(/^CSV row (\d+): (.+)$/);if(csv)return `CSV 第 ${csv[1]} 行：${tr(csv[2])}`;
 for(const [pattern,translation] of Object.entries(ZH_HANT)){
  if(!pattern.includes('{'))continue;const indexes=[];
  const expression=pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\{(\d+)\\\}/g,(_,n)=>{indexes.push(Number(n));return '([\\s\\S]*?)';});
  const match=key.match(new RegExp('^'+expression+'$'));if(!match)continue;
  const parameters=[];indexes.forEach((n,i)=>parameters[n]=match[i+1]);return translation.replace(/\{(\d+)\}/g,(_,n)=>parameters[Number(n)]??'');
 }
 return text;
}
function localizedPhrase(value){
 const slots=[];const key=canonicalText(value.replace(/__CC_SLOT_(\d+)__/g,token=>'{'+(slots.push(token)-1)+'}'));
 const translated=ZH_HANT[key];if(translated===undefined)return value;
 return value.replace(value.trim(),translated.replace(/\{(\d+)\}/g,(_,n)=>slots[Number(n)]??''));
}
function i18nMarkup(value){
 const source=String(value);if(uiLanguage==='en')return source;
 const decode=s=>s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
 const encode=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 return source.replace(/<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+|</g,token=>{
  if(token.startsWith('<'))return token.replace(/\b(aria-label|title|placeholder|alt)\s*=\s*(["'])(.*?)\2/g,(all,name,quote,text)=>{const decoded=decode(text),next=localizedPhrase(decoded);return next===decoded?all:name+'='+quote+encode(next)+quote;});
  const decoded=decode(token),next=localizedPhrase(decoded);return next===decoded?token:encode(next);
 });
}
function i18nHtml(strings,...values){
 const pattern=strings.reduce((result,part,i)=>result+(i?'__CC_SLOT_'+(i-1)+'__':'')+part,'');
 // Translate source-authored phrases before inserting any company or user data.
 return i18nMarkup(pattern).replace(/__CC_SLOT_(\d+)__/g,(_,n)=>String(values[Number(n)]??''));
}
function languageSelector(){return `<label class="language-switch"><span class="sr-only">${tr('Language')}</span><select data-language-switch aria-label="${tr('Language')}"><option value="en" ${uiLanguage==='en'?'selected':''}>English</option><option value="zh-Hant" ${uiLanguage==='zh-Hant'?'selected':''}>繁體中文</option></select></label>`;}
function setLanguage(language){
 if(!['en','zh-Hant'].includes(language)||$('#dialog')?.open)return;
 const forms=typeof document.querySelectorAll==='function'?[...document.querySelectorAll('form[id]')].flatMap(form=>[...form.elements].filter(e=>e.name&&e.type!=='file').map(e=>({form:form.id,index:[...form.elements].indexOf(e),name:e.name,value:e.value,checked:e.checked,type:e.type}))):[];
 uiLanguage=language;localStorage.setItem('cc-language',language);render();
 for(const saved of forms){const form=document.getElementById?.(saved.form),element=form?.elements[saved.index];if(!element)continue;if(saved.type==='checkbox'||saved.type==='radio')element.checked=saved.checked;else element.value=saved.value;}
}
function applyLanguageMetadata(){if(document.documentElement){document.documentElement.lang=uiLanguage==='zh-Hant'?'zh-Hant':'en';const skip=document.querySelector?.('.skip-link');if(skip)skip.textContent=tr('Skip to content');const dialog=document.querySelector?.('#dialog');dialog?.setAttribute?.('aria-label',tr('Currenc Connect dialog'));document.title=uiLanguage==='zh-Hant'?'Currenc Connect｜股東代幣獎勵':'Currenc Connect';}}
