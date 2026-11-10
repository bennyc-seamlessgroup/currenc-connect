import {randomBytes, createHash} from 'node:crypto';
import worker from '../dist/server/index.js';
import {getCloudDatabase} from './neon-database.mjs';

const cookieName = '__Host-cc-session';
const json = (data,status) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const runtime = {environment:'Vercel sandbox',storage:'Cloud database',identity:'Browser session · no account login'};

export function createVercelWorkspaceHandler({database=getCloudDatabase, environment=()=>process.env}={}) {
  return async function handle(request) {
    const url = new URL(request.url);
    if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed'},405);
    if (request.method==='POST' && (request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')) {
      return json({error:'Cross-origin requests are not allowed.'},403);
    }
    const env = environment();
    const connectionString = env.DATABASE_URL || env.POSTGRES_URL;
    if (!connectionString) return json({error:'Cloud workspace is not configured. Connect a Neon database to this Vercel project and redeploy.',code:'DATABASE_NOT_CONFIGURED'},503);
    const cookies = (request.headers.get('Cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
    const value = cookies.length===1?cookies[0].slice(cookieName.length+1):'';
    const existing = /^[A-Za-z0-9_-]{43}$/.test(value);
    if (request.method==='POST' && !existing) return json({error:'Refresh the workspace before making changes.'},409);
    const token = existing?value:randomBytes(32).toString('base64url');
    const id = 'session:'+createHash('sha256').update(token).digest('hex');
    try {
      const DB = await database(connectionString);
      // Never accept a caller-supplied identity or expose database credentials.
      const headers = new Headers(request.headers);
      headers.delete('oai-authenticated-user-email');
      headers.set('oai-authenticated-user-id',id);
      const internal = new Request(new URL('/api/workspace',url),{
        method:request.method,headers,
        ...(request.method==='POST'?{body:await request.text()}:{}),
      });
      const response = await worker.fetch(internal,{DB});
      const data = await response.json();
      const outputHeaders = new Headers(response.headers);
      if (response.ok && !existing) outputHeaders.set('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
      return Response.json({...data,...(response.ok?{runtime}:{})},{status:response.status,headers:outputHeaders});
    } catch {
      // Do not log connection strings or customer records on connection errors.
      console.error('Cloud workspace database connection failed');
      return json({error:'Cloud database unavailable. Check the database connection and try again.'},503);
    }
  };
}
