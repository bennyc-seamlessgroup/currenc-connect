import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {createSqliteDatabase} from '../server/sqlite-database.mjs';
import {createPlatform,PlatformError} from '../server/platform.mjs';
import {seedState} from '../dist/server/domain.mjs';
import {createDocumentHandler} from '../server/company-documents.mjs';

// The Worker API and domain rules are shared with local development.
// SQLite is a local storage adapter, not a serverless deployment database.
export async function createLocalServer({databasePath = '.local/workspace.sqlite'} = {}) {
  await mkdir(new URL('../.local/', import.meta.url), {recursive:true});
  const DB=createSqliteDatabase(databasePath);
  // Keep existing loopback data and give a new local database the familiar demo.
  await DB.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind('local-demo',JSON.stringify(seedState())).run();
  const platformOptions={bootstrapOwner:{email:'demo@example.com',issuer:'local-development'}};
  const platform=createPlatform(DB,platformOptions);
  const identity={accountId:'local-demo',issuer:'local-development',user:{email:'demo@example.com',name:'Local developer',emailVerified:true}};
  const documentHandler=createDocumentHandler({identity:async()=>identity,database:async()=>DB,platformOptions});
  const {default:worker} = await import('../dist/server/index.js');
  const server = createServer(async (req,res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) {
        res.writeHead(403, {'Content-Type':'text/plain'});
        res.end('This workspace is available on localhost only.');
        return;
      }
      const chunks = [];
      let received=0;for await (const chunk of req){received+=chunk.length;if(received>3*1024*1024)throw new PlatformError('Request too large',413);chunks.push(chunk);}
      const headers = new Headers();
      for (const [key,value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value)?value.join(','):value);
      // Only this loopback server supplies the shared local demo identity.
      headers.set('oai-authenticated-user-id','local-demo');
      headers.set('oai-authenticated-user-email','demo@example.com');
      const method = req.method || 'GET';
      // Preserve the browser origin so writes work from localhost and 127.0.0.1.
      const request = new Request(new URL(req.url, `http://${host}`), {
        method, headers,
        ...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{}),
      });
      let response;
      if(new URL(request.url).pathname==='/api/company-document')response=await documentHandler(request);
      else if(new URL(request.url).pathname==='/api/workspace') {
        if(!['GET','POST'].includes(method))response=Response.json({error:'Method not allowed'},{status:405});
        else if(method==='POST'&&headers.get('Origin')!==new URL(request.url).origin)response=Response.json({error:'Cross-origin requests are not allowed.'},{status:403});
        else {
          let selection={view:new URL(request.url).searchParams.get('view')||undefined,organizationId:new URL(request.url).searchParams.get('organization')||undefined,page:new URL(request.url).searchParams.get('page'),search:new URL(request.url).searchParams.get('search')};
          if(method==='POST') {
            if(Buffer.concat(chunks).length>12000)throw new PlatformError('Request too large',413);
            let command;try{command=await request.json();}catch{throw new PlatformError('Invalid request',400);}
            selection=await platform.execute(identity,command);
          }
          response=Response.json({...await platform.read(identity,selection),runtime:{environment:'Local sandbox',storage:'Local SQLite database',identity:'Local developer · company memberships'}},{headers:{'Cache-Control':'no-store'}});
        }
      }else response = await worker.fetch(request, {DB});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if(error instanceof PlatformError){res.writeHead(error.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,...(error.code?{code:error.code}:{})}));return;}
      console.error(error);
      res.writeHead(500, {'Content-Type':'text/plain'});
      res.end('Unable to load the local workspace.');
    }
  });
  server.on('close', () => DB.close());
  return server;
}
