import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {get} from 'node:http';
import {createLocalServer} from '../scripts/local-server.mjs';

test('local workspace accepts localhost and loopback writes, persists across restarts and rejects other origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'currenc-connect-test-'));
  const databasePath = join(directory, 'workspace.sqlite');
  let server;
  const start = async () => {
    server = await createLocalServer({databasePath});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  };
  const stop = async () => { const done=once(server,'close');server.close();await done; };
  try {
    let port = await start();
    for (const host of ['localhost','127.0.0.1']) {
      const origin = `http://${host}:${port}`;
      const response = await fetch(`${origin}/api/workspace`, {
        method:'POST', headers:{'Content-Type':'application/json',Origin:origin},
        body:JSON.stringify({type:'kyc',name:'Local Investor',email:'local@example.com',country:'Hong Kong',consent:true}),
      });
      assert.equal(response.status,200);
      assert.equal((await response.json()).state.profile.name,'Local Investor');
    }
    const address = `http://127.0.0.1:${port}/api/workspace`;
    assert.equal((await fetch(address,{method:'POST',headers:{Origin:'https://other.test'},body:JSON.stringify({type:'reset'})})).status,403);
    const hostStatus = await new Promise((resolve,reject)=>{
      const request=get(address,{headers:{Host:`other.test:${port}`}},response=>{response.resume();resolve(response.statusCode);});
      request.on('error',reject);
    });
    assert.equal(hostStatus,403);
    await stop();
    port = await start();
    const saved = await (await fetch(`http://localhost:${port}/api/workspace`)).json();
    assert.equal(saved.state.profile.name,'Local Investor');
    assert.equal(saved.accountRevision,2);
  } finally {
    if (server?.listening) await stop();
    await rm(directory,{recursive:true,force:true});
  }
});
