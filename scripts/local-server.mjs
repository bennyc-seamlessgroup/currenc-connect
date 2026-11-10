import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile, mkdir} from 'node:fs/promises';

// The Worker API and domain rules are shared with local development.
// SQLite is a local storage adapter, not a serverless deployment database.
export async function createLocalServer({databasePath = '.local/workspace.sqlite'} = {}) {
  await mkdir(new URL('../.local/', import.meta.url), {recursive:true});
  const db = new DatabaseSync(databasePath);
  db.exec(await readFile(new URL('../drizzle/0000_workspace.sql', import.meta.url), 'utf8'));
  const DB = {prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async run() { return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}; },
    };
  }};
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
      for await (const chunk of req) chunks.push(chunk);
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
      const response = await worker.fetch(request, {DB});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(500, {'Content-Type':'text/plain'});
      res.end('Unable to load the local workspace.');
    }
  });
  server.on('close', () => db.close());
  return server;
}
