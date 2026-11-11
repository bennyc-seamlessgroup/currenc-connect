import ts from 'typescript';
import {readFileSync} from 'node:fs';

export const UI_FILES=['app','governance-ui','campaign-ui','portal-ui','landing-ui','holding-ui','wallet-ui','testnet-ui','managed-airdrop-ui'];
const visibleArgs={title:[0],btn:[0],field:[0],campaignField:[0,2],infoTip:[0,1],notice:[0],empty:[0,1],openModal:[0],toast:[0],reasonForm:[0],stat:[0]};
const htmlPattern=/<\/?[a-zA-Z][\s\S]*?>/;
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
export const canonical=s=>decode(s).trim().replace(/\s+/g,' ');
export function markupPhrases(source){
 const phrases=[];
 for(const token of source.match(/<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+|</g)||[]){
  if(token.startsWith('<')){for(const m of token.matchAll(/\b(?:aria-label|title|placeholder|alt)\s*=\s*(["'])(.*?)\1/g))phrases.push(m[2]);}
  else phrases.push(token);
 }
 return phrases.map(value=>canonical(value).replace(/\{\d+\}/g,(()=>{let i=0;return()=>'{'+(i++)+'}';})())).filter(s=>/[a-zA-Z]/.test(s)&&!/^\{\d+\}$/.test(s));
}
function templateText(node){return ts.isTemplateExpression(node)?node.head.text+node.templateSpans.map((span,i)=>'{'+i+'}'+span.literal.text).join(''):node.text;}
function displayLiteral(node){
 const parent=node.parent;
 if(ts.isCallExpression(parent)&&ts.isIdentifier(parent.expression)&&visibleArgs[parent.expression.text]?.includes(parent.arguments.indexOf(node)))return true;
 if(ts.isReturnStatement(parent))return true;
 if(ts.isConditionalExpression(parent)&&parent.condition!==node)return true;
 if(ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name)&&/^(title|description|label|next|help|message|heading|reason)$/.test(parent.name.text))return true;
 return false;
}
export function prepareUI(source,{translations={},collect=false}={}){
 const file=ts.createSourceFile('ui.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[],phrases=new Set();
 function visit(node){
  if(ts.isTemplateExpression(node)||ts.isNoSubstitutionTemplateLiteral(node)){
   if(!ts.isTaggedTemplateExpression(node.parent)){
    const value=templateText(node),markup=htmlPattern.test(value);if(markup)markupPhrases(value).forEach(v=>phrases.add(v));
    else if(displayLiteral(node)||/[a-zA-Z]/.test(value)&&value.includes('{'))phrases.add(canonical(value));
    if(markup||displayLiteral(node)&&!/^[-a-z_]+$/.test(value)&&Object.hasOwn(translations,canonical(value)))edits.push({start:node.getStart(file),end:node.getStart(file),text:'i18nHtml'});
   }
  }else if(ts.isStringLiteral(node)){
   const value=node.text,markup=htmlPattern.test(value);if(markup)markupPhrases(value).forEach(v=>phrases.add(v));else if(displayLiteral(node))phrases.add(canonical(value));
   if(markup||displayLiteral(node)&&!/^[-a-z_]+$/.test(value)&&Object.hasOwn(translations,canonical(value)))edits.push({start:node.getStart(file),end:node.end,text:(markup?'i18nMarkup':'tr')+'('+source.slice(node.getStart(file),node.end)+')'});
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 if(collect)return [...phrases].filter(v=>/[a-zA-Z]/.test(v)&&v.length>1);
 return edits.sort((a,b)=>b.start-a.start||b.end-a.end).reduce((text,e)=>text.slice(0,e.start)+e.text+text.slice(e.end),source);
}
export function readUI(translations){return UI_FILES.map(name=>prepareUI(readFileSync('src/'+name+'.js','utf8').replace(/^import[^\n]+\n/,''),{translations})).join('\n');}
export function localeSource(){return 'const ZH_HANT='+readFileSync('src/locales/zh-Hant.json','utf8')+';\n'+readFileSync('src/i18n.js','utf8');}
