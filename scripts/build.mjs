import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const domain=stripTypeScriptTypes(await readFile('lib/domain.ts','utf8'));
const app=(await readFile('src/app.js','utf8')).replace(/^import[^\n]+\n/,'');
const assets={
 '/':{type:'text/html; charset=utf-8',body:await readFile('src/index.html','utf8')},
 '/styles.css':{type:'text/css; charset=utf-8',body:await readFile('src/styles.css','utf8')},
 '/app.js':{type:'text/javascript; charset=utf-8',body:domain+'\n'+app},
 '/favicon.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#101f29"/><g stroke="#d8ec90" stroke-width="3" fill="none" stroke-linecap="round"><path d="M27 12a12 12 0 1 0 0 24 M34 12a12 12 0 1 0 0 24 M17 24h21"/></g></svg>'}
};
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const worker=domain+'\nconst ASSETS='+JSON.stringify(assets)+';\n'+await readFile('src/worker.js','utf8');
await writeFile('dist/server/index.js',worker);await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log(`Built Currenc Connect Worker: ${(Buffer.byteLength(worker)/1024).toFixed(1)} KiB · 0 external dependencies`);
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
  return {ok:true,json:async()=>({state:saved,revision:0})};
}
`;
const offlineApp=app.replaceAll("fetch('/api/workspace'","offlineFetch('/api/workspace'")
 .replace('<span class="sandbox-tag">Sandbox</span>', '<span class="sandbox-tag">Offline sandbox</span>')
 .replace("['Environment','Local sandbox']", "['Environment','Offline sandbox']")
 .replace("['Storage','Local SQLite database']", "['Storage','This browser only']")
 .replace('this local demo workspace', 'this offline demo workspace')
 .replace('Data is saved in the local database.', 'Data is saved in this browser only.');
let offline=assets['/'].body.replace('<link rel="stylesheet" href="/styles.css">','<style>'+assets['/styles.css'].body+'</style>')
 .replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">','')
 .replace('<script type="module" src="/app.js"></script>','<script type="module">'+(domain+'\n'+offlineAdapter+'\n'+offlineApp).replaceAll('</script','<\\/script')+'</script>');
await mkdir('outputs',{recursive:true});await writeFile('outputs/Currenc_Connect_Offline.html',offline);
console.log('Portable offline demo: outputs/Currenc_Connect_Offline.html');

}
