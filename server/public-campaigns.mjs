import {getCloudDatabase} from './neon-database.mjs';

// Anonymous discovery is a deliberately small projection. Never return the
// stored workspace, shareholder records, contacts, funds, files or team data.
export async function readPublicCampaigns(DB,{now=new Date()}={}) {
 const today=now.toISOString().slice(0,10);
 const [companies,controls,settings]=await Promise.all([
  DB.query("SELECT o.id,o.company,o.data FROM cc_organizations o JOIN cc_company_status s ON s.organization_id=o.id WHERE s.status='approved' AND s.visible=1 ORDER BY o.created_at,o.id"),
  DB.query('SELECT organization_id,campaign_id,visible,paused FROM cc_campaign_controls'),
  DB.query("SELECT shareholder_registrations FROM cc_portal_settings WHERE id='portal'")
 ]);
 const registrationsOpen=settings[0]?.shareholder_registrations!==0;
 const moderation=new Map(controls.map(c=>[c.organization_id+'\0'+c.campaign_id,c]));
 const campaigns=[];
 for(const row of companies){
  const company=JSON.parse(row.company),data=JSON.parse(row.data);
  for(const c of data.campaigns||[]){
   const control=moderation.get(row.id+'\0'+c.id),claimDeadline=c.claimDeadline||c.deadline,registrationDeadline=c.registrationDeadline||c.deadline;
   if(c.delivery==='sepolia'||c.company!==row.id||!['open','locked','paused'].includes(c.status)||control?.visible===0||!/^\d{4}-\d{2}-\d{2}$/.test(claimDeadline||'')||claimDeadline<today)continue;
   campaigns.push({
    id:c.id,name:c.name,description:c.description||'',token:c.token,
    company:{id:row.id,name:company.name,ticker:company.ticker,initials:company.initials,color:/^#[0-9a-f]{6}$/i.test(company.color||'')?company.color:'#39796f'},
    status:control?.paused===1?'paused':c.status,mode:c.mode,ratio:c.ratio,budget:c.budget,minimum:c.minimum,cap:c.cap,
    chains:(c.chains||[]).filter(chain=>['ETH','SOL','BNB'].includes(chain)),snapshotDate:c.snapshotDate,registrationDeadline,claimDeadline,
    canRegister:registrationsOpen&&c.status==='open'&&control?.paused!==1&&registrationDeadline>=today
   });
  }
 }
 return {campaigns};
}

export function createPublicCampaignsHandler({database=getCloudDatabase,environment=()=>process.env,now=()=>new Date()}={}){
 return async request=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET'}});
  try{
   const connection=environment().DATABASE_URL||environment().POSTGRES_URL;
   if(!connection)return Response.json({error:'Campaigns are temporarily unavailable.'},{status:503,headers});
   return Response.json(await readPublicCampaigns(await database(connection),{now:now()}),{headers});
  }catch{
   return Response.json({error:'Campaigns are temporarily unavailable.'},{status:503,headers});
  }
 };
}
