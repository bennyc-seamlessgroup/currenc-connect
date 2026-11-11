import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {dirname} from 'node:path';
import {build as bundle} from 'esbuild';
import {stripTypeScriptTypes} from 'node:module';
import {readUI,localeSource} from './ui-source.mjs';
const domain=stripTypeScriptTypes(await readFile('lib/domain.ts','utf8'));
const chainLogos=Object.fromEntries(await Promise.all([['ETH','ethereum'],['SOL','solana'],['BNB','bnb']].map(async([chain,file])=>[chain,'data:image/svg+xml;base64,'+(await readFile(`src/assets/chains/${file}.svg`)).toString('base64')])));
const brandSymbol=await readFile('src/assets/brand/symbol.svg','utf8');
const translations=JSON.parse(await readFile('src/locales/zh-Hant.json','utf8'));
const app=localeSource()+'\nconst brandSymbol='+JSON.stringify(brandSymbol)+';\nconst chainLogoData='+JSON.stringify(chainLogos)+';\n'+readUI(translations);
const walletRuntime=(await bundle({entryPoints:['src/wallet-runtime.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true})).outputFiles[0].text;
const assets={
 '/':{type:'text/html; charset=utf-8',body:await readFile('src/index.html','utf8')},
 '/styles.css':{type:'text/css; charset=utf-8',body:await readFile('src/styles.css','utf8')},
 '/app.js':{type:'text/javascript; charset=utf-8',body:domain+'\n'+app},
 '/images/shareholder-rewards.png':{type:'image/png',base64:true,body:(await readFile('src/assets/landing/shareholder-rewards.png')).toString('base64')},
 '/wallet-runtime.js':{type:'text/javascript; charset=utf-8',body:walletRuntime},
 '/favicon.svg':{type:'image/svg+xml',body:brandSymbol}
};
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/client',{recursive:true});await mkdir('dist/.openai',{recursive:true});
// Vercel serves only browser assets from this directory, never the Worker source.
for (const [path,asset] of Object.entries(assets)) {
 const target=`dist/client/${path==='/'?'index.html':path.slice(1)}`;
 await mkdir(dirname(target),{recursive:true});
 await writeFile(target,asset.base64?Buffer.from(asset.body,'base64'):asset.body);
}
const worker=domain+'\nconst ASSETS='+JSON.stringify(assets)+';\n'+await readFile('src/worker.js','utf8');
await writeFile('dist/server/index.js',worker);await cp('.openai/hosting.json','dist/.openai/hosting.json');
await writeFile('dist/server/domain.mjs',domain);
await import('./compile-contracts.mjs');
console.log(`Built Currenc Connect Worker: ${(Buffer.byteLength(worker)/1024).toFixed(1)} KiB · 0 external dependencies`);
console.log('Built browser assets: dist/client');
// Offline export is optional; the primary app uses the local API and SQLite.
if (process.argv.includes('--offline')) {
const offlineAdapter=`
const OFFLINE_KEY='currenc-connect-offline-v1';
async function offlineFetch(_url, options) {
  let saved; try { saved=JSON.parse(localStorage.getItem(OFFLINE_KEY)); } catch {}
  if(!saved || saved.version!==1) saved=seedState();
  if(options?.method==='POST') {
    try { saved=applyCommand(saved,JSON.parse(options.body));localStorage.setItem(OFFLINE_KEY,JSON.stringify(saved)); }
    catch(error) { return {ok:false,json:async()=>({error:error.message})}; }
  } else localStorage.setItem(OFFLINE_KEY,JSON.stringify(saved));
  return {ok:true,json:async()=>({state:saved,revision:0,runtime:{environment:'Offline demonstration',storage:'This browser only',identity:'Shared demo workspace'}})};
}
`;
const offlineApp=app.replaceAll("fetch('/api/workspace'","offlineFetch('/api/workspace'")
 .replaceAll('/images/shareholder-rewards.png','data:image/png;base64,'+assets['/images/shareholder-rewards.png'].body)
  .replace('this demo workspace', 'this offline demo workspace')
 .replace('Data is saved in your workspace database.', 'Data is saved in this browser only.');
let offline=assets['/'].body.replace('<link rel="stylesheet" href="/styles.css">','<style>'+assets['/styles.css'].body+'</style>')
 .replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">','')
 .replace('<script type="module" src="/app.js"></script>','<script type="module">'+(domain+'\n'+offlineAdapter+'\n'+offlineApp).replaceAll('</script','<\\/script')+'</script>');
await mkdir('outputs',{recursive:true});await writeFile('outputs/Currenc_Connect_Offline.html',offline);
console.log('Portable offline demo: outputs/Currenc_Connect_Offline.html');

}
