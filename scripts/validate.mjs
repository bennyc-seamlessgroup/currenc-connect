import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {default:worker}=await import('../dist/server/index.js');
for(const [path,type]of [['/','text/html'],['/app.js','text/javascript'],['/styles.css','text/css'],['/favicon.svg','image/svg+xml'],['/images/shareholder-rewards-vertical.jpg','image/jpeg']]){
 const r=await worker.fetch(new Request('https://demo.test'+path),{});assert.equal(r.status,200);assert.ok(r.headers.get('Content-Type').startsWith(type));assert.ok((await r.text()).length>0);
}
assert.equal((await worker.fetch(new Request('https://demo.test/api/workspace'),{})).status,401);
assert.equal((await worker.fetch(new Request('https://demo.test/missing'),{})).status,404);
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));assert.ok(manifest.project_id);assert.equal(manifest.d1,'DB');
console.log('Validated: Worker export, assets, auth guard, 404, hosting manifest.');
