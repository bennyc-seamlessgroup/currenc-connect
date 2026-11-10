const responseJson = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff' } });
async function loadWorkspace(db, id) {
  await db.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision) VALUES (?, ?, 0)').bind(id, JSON.stringify(seedState())).run();
  return await db.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(id).first();
}
async function api(request, env) {
  const id=request.headers.get('oai-authenticated-user-id');
  if(!id)return responseJson({error:'Sign in to load your workspace.',signIn:true},401);
  if(!env.DB)return responseJson({error:'Database unavailable. Try again later.'},503);
  if(request.method==='GET'){
    try {const row=await loadWorkspace(env.DB,id);return responseJson({state:JSON.parse(row.data),revision:row.revision});}
    catch(error){console.error('Workspace load failed',error);return responseJson({error:'Unable to load workspace. Try again later.'},503);}
  }
  if(request.method!=='POST')return responseJson({error:'Method not allowed'},405);
  const origin=request.headers.get('Origin');
  if(origin && origin!==new URL(request.url).origin)return responseJson({error:'Cross-origin requests are not allowed.'},403);
  let command;
  try{const text=await request.text();if(text.length>12000)return responseJson({error:'Request too large'},413);command=JSON.parse(text);}catch{return responseJson({error:'Invalid request'},400);}
  for(let retry=0;retry<3;retry++){
    try{
      const row=await loadWorkspace(env.DB,id);let next;
      try{next=applyCommand(JSON.parse(row.data),command);}catch(error){return responseJson({error:error.message||'Unable to complete the action.'},422);}
      const result=await env.DB.prepare('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(next),id,row.revision).run();
      if(result.meta.changes===1)return responseJson({state:next,revision:row.revision+1});
    }catch(error){console.error('Workspace write failed',error);return responseJson({error:'Unable to save. Try again later.'},503);}
  }
  return responseJson({error:'Workspace changed. Try again.'},409);
}
export default {
  async fetch(request, env) {
    const path=new URL(request.url).pathname;
    if(path==='/api/workspace')return api(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const asset=ASSETS[path];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}});
  }
};
