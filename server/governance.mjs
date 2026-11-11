import {createHash,randomUUID} from 'node:crypto';
import {PlatformError,requireValue} from './errors.mjs';

const stmt=(sql,values=[])=>({sql,values});
const changed='EXISTS (SELECT 1 FROM changed)';
const active=(parameter)=>`NOT EXISTS (SELECT 1 FROM cc_account_controls ac WHERE ac.account_id=${parameter} AND (ac.status='suspended' OR ac.archived=1))`;
const adminGuard=parameter=>`EXISTS (SELECT 1 FROM cc_platform_admins pa WHERE pa.account_id=${parameter}) AND ${active(parameter)}`;
const memberGuard=(organization,account)=>`EXISTS (SELECT 1 FROM cc_memberships m WHERE m.organization_id=${organization} AND m.account_id=${account} AND m.role IN ('owner','admin')) AND ${active(account)}`;
const legacyCompany=(id,owner)=>['curr','north','harbor'].find(key=>id==='org-'+createHash('sha256').update(owner+'\0'+key).digest('hex').slice(0,32));
export const APPLICATION_FIELDS={legalName:120,registrationNumber:80,jurisdiction:80,website:300,contactName:80,contactEmail:254,representativeRole:80,address:400,listingMarket:40};
export function validateCompanyInfo(input){
  const output={};
  for(const [key,max]of Object.entries(APPLICATION_FIELDS)){
    const value=input?.[key]??'';requireValue(typeof value==='string'&&value.length<=max,'Check the company information fields.');output[key]=value.trim();
  }
  if(output.contactEmail)requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.contactEmail),'Enter a valid contact email.');
  if(output.website){let website;try{website=new URL(output.website);}catch{}requireValue(website?.protocol==='https:'&&!website.username&&!website.password,'Enter an HTTPS company website.');}
  return output;
}
export function createGovernance(DB,{now=()=>new Date(),bootstrapOwner}={}){
  const query=(sql,values=[])=>DB.query(sql,values);
  const one=async(sql,values=[]) => (await query(sql,values))[0]||null;
  const at=()=>now().toISOString();
  const audit=(actor,action,type,id,detail)=>stmt(`INSERT INTO cc_platform_audit (id,actor_id,action,target_type,target_id,detail,created_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE ${changed} RETURNING id`,[randomUUID(),actor,action,type,id,typeof detail==='string'?detail:JSON.stringify(detail),at()]);
  const invalidate=id=>stmt(`UPDATE cc_organizations SET revision=revision+1 WHERE id=$1 AND ${changed} RETURNING id`,[id]);
  const checked=rows=>requireValue(rows.length,'The record or your permissions changed. Reload and try again.',409);
  async function accountActive(accountId){
    const row=await one('SELECT status,archived FROM cc_account_controls WHERE account_id=$1',[accountId]);
    if(row?.archived===1)throw new PlatformError('All portal access is disabled, including shareholder access. Contact the platform team.',403,'ACCOUNT_REMOVED');
    if(row?.status==='suspended')throw new PlatformError('All portal access is disabled, including shareholder access. Contact the platform team.',403,'ACCOUNT_SUSPENDED');
  }
  async function acceptAccountInvitations(identity){
    if(identity.user.emailVerified!==true)return;
    await DB.atomicChange(stmt("UPDATE cc_account_invitations SET status='accepted',accepted_by=$1 WHERE email=$2 AND status='pending' AND expires_at>$3 RETURNING id",[identity.accountId,identity.user.email.trim().toLowerCase(),at()]),[audit(identity.accountId,'Account invitation accepted','account',identity.accountId,'Verified email sign-in; no company or platform privileges granted')]);
  }
  async function platformRole(accountId){return (await one('SELECT role FROM cc_platform_admins WHERE account_id=$1',[accountId]))?.role||null;}
  async function checkAccount(identity){
    await accountActive(identity.accountId);
    // Deployment-controlled, verified identity binding used once. There is no
    // first-user, company-owner or request-header route to platform ownership.
    if(bootstrapOwner?.email&&identity.user.emailVerified===true&&identity.user.email.trim().toLowerCase()===bootstrapOwner.email.trim().toLowerCase()&&identity.issuer===bootstrapOwner.issuer){
      try{await DB.atomicChange(stmt("INSERT INTO cc_platform_admins (account_id,role,created_at) SELECT $1,'owner',$2 WHERE NOT EXISTS (SELECT 1 FROM cc_platform_admins WHERE role='owner') ON CONFLICT (account_id) DO NOTHING RETURNING account_id",[identity.accountId,at()]),[audit(identity.accountId,'Platform owner initialized','account',identity.accountId,'Deployment-authorized verified account')]);}
      catch(error){if(error.code!=='23505')throw error;}
    }
  }
  async function requireAdmin(identity,ownerOnly=false){await accountActive(identity.accountId);const role=await platformRole(identity.accountId);requireValue(role&&(!ownerOnly||role==='owner'),'Platform administrator access required.',403);return role;}
  async function settings(){return one("SELECT * FROM cc_portal_settings WHERE id='portal'");}
  async function status(id){
    await query('INSERT INTO cc_company_status (organization_id,created_at) SELECT id,created_at FROM cc_organizations WHERE id=$1 ON CONFLICT (organization_id) DO NOTHING',[id]);
    return one('SELECT * FROM cc_company_status WHERE organization_id=$1',[id]);
  }
  async function companyAccess(identity,id){await requireAdmin(identity);requireValue(await one('SELECT id FROM cc_organizations WHERE id=$1',[id]),'Company unavailable.',404);}
  async function documents(id,includeArchive=false){return query(`SELECT id,purpose,filename,mime,size,sha256,application_revision,archived,created_at FROM cc_company_documents WHERE organization_id=$1${includeArchive?'':' AND archived=0'} ORDER BY created_at,id`,[id]);}
  async function application(identity,id){
    await companyAccess(identity,id);const row=await status(id);requireValue(row,'Company unavailable.',404);
    return {...row,application:JSON.parse(row.application),documents:await documents(id),reviews:await query('SELECT r.action,r.note,r.application_revision,r.created_at,a.email AS reviewer FROM cc_company_reviews r JOIN cc_accounts a ON a.id=r.reviewed_by WHERE r.organization_id=$1 ORDER BY r.created_at DESC',[id])};
  }
  async function saveCompany(identity,cmd){
    const current=await status(cmd.organizationId),org=await one('SELECT * FROM cc_organizations WHERE id=$1',[cmd.organizationId]);requireValue(current&&org,'Company unavailable.',404);
    requireValue(Number.isInteger(cmd.revision)&&cmd.revision===current.revision&&cmd.organizationRevision===org.revision,'Company details changed. Reload and try again.',409);
    const info=validateCompanyInfo(cmd.info),meta=JSON.parse(org.company);
    requireValue(typeof cmd.name==='string'&&cmd.name.trim()&&cmd.name.trim().length<=80,'Enter a valid company name.');
    requireValue(typeof cmd.ticker==='string'&&/^[A-Za-z0-9.-]{1,12}$/.test(cmd.ticker.trim()),'Enter a valid ticker.');
    const company={...meta,name:cmd.name.trim(),ticker:cmd.ticker.trim().toUpperCase(),initials:cmd.name.trim().slice(0,1).toUpperCase()};
    const data=JSON.parse(org.data);data.companies=data.companies.map(c=>c.id===org.id?company:c);
    checked(await DB.atomicChange(stmt(`UPDATE cc_organizations SET company=$1,data=$2,revision=revision+1 WHERE id=$3 AND revision=$4 AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$3 AND revision=$5) AND ${adminGuard('$6')} RETURNING id`,[JSON.stringify(company),JSON.stringify(data),org.id,org.revision,current.revision,identity.accountId]),[
      stmt(`UPDATE cc_company_status SET application=$1,revision=revision+1 WHERE organization_id=$2 AND ${changed} RETURNING organization_id`,[JSON.stringify(info),org.id]),
      audit(identity.accountId,'Company details updated','company',org.id,{name:company.name,ticker:company.ticker})
    ]));return {view:'platform',organizationId:org.id};
  }
  const profileText=field=>DB.dialect==='postgres'?`COALESCE(a.profile::jsonb->>'${field}','')`:`COALESCE(json_extract(a.profile,'$.${field}'),'')`;
  const profileComplete=DB.dialect==='postgres'?"(a.profile::jsonb->'kyc')='true'::jsonb":"json_type(a.profile,'$.kyc')='true'";
  const disabledAccount="(COALESCE(c.archived,0)=1 OR c.status='suspended')";
  function identityProfile(raw){
    const profile=JSON.parse(raw),complete=profile.kyc===true;
    const text=(key,max)=>complete&&typeof profile[key]==='string'?profile[key].slice(0,max):'';
    return {name:text('name',60),email:text('email',120),country:text('country',80),complete,simulated:true};
  }
  async function platformRead(identity,selection={}){
    const role=await requireAdmin(identity),page=Math.max(1,Math.min(10000,Math.trunc(Number(selection.page)||1))),offset=(page-1)*50;
    const search=typeof selection.search==='string'?selection.search.trim().slice(0,254).toLowerCase():'';
    const pattern='%'+search.replace(/[!%_]/g,c=>'!'+c)+'%';
    const companies=await query("SELECT o.id,o.company,o.owner_id,a.email AS owner_email,s.status,s.revision,s.visible,s.approval_mode,s.submitted_at,s.review_note FROM cc_organizations o JOIN cc_accounts a ON a.id=o.owner_id JOIN cc_company_status s ON s.organization_id=o.id WHERE LOWER(o.company) LIKE $1 ESCAPE '!' OR LOWER(a.email) LIKE $1 ESCAPE '!' ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.submitted_at DESC,o.created_at DESC,o.id LIMIT 51 OFFSET $2",[pattern,offset]);
    const accountFilter=selection.accountFilter==='removed'?'removed':'current';
    const profileMatch=`${profileComplete} AND (${['name','email','country'].map(field=>`LOWER(${profileText(field)}) LIKE $1 ESCAPE '!'`).join(' OR ')})`;
    const accounts=await query(`SELECT a.id,a.email,a.name,a.profile AS identity_data,a.created_at,CASE WHEN ${disabledAccount} THEN 'removed' ELSE 'active' END AS status,COALESCE(c.revision,0) AS control_revision,p.role AS platform_role,(SELECT COUNT(*) FROM cc_memberships m WHERE m.account_id=a.id) AS companies FROM cc_accounts a LEFT JOIN cc_account_controls c ON c.account_id=a.id LEFT JOIN cc_platform_admins p ON p.account_id=a.id WHERE (LOWER(a.email) LIKE $1 ESCAPE '!' OR LOWER(a.name) LIKE $1 ESCAPE '!' OR (${profileMatch})) AND CASE WHEN ${disabledAccount} THEN 1 ELSE 0 END=$3 ORDER BY a.created_at DESC,a.id LIMIT 51 OFFSET $2`,[pattern,offset,accountFilter==='removed'?1:0]);
    // Only the authorized, paginated account list receives company role metadata.
    const accountPage=accounts.slice(0,50),accountIds=accountPage.map(a=>a.id);
    const memberships=accountIds.length?await query(`SELECT m.account_id,m.organization_id,m.role,o.company FROM cc_memberships m JOIN cc_organizations o ON o.id=m.organization_id WHERE m.account_id IN (${accountIds.map((_,i)=>'$'+(i+1)).join(',')}) ORDER BY m.created_at,m.organization_id`,accountIds):[];
    const accountRows=accountPage.map(({identity_data,...a})=>({...a,identityProfile:identityProfile(identity_data),companyRoles:memberships.filter(m=>m.account_id===a.id).map(m=>{const company=JSON.parse(m.company);return {organizationId:m.organization_id,name:company.name,role:m.role};})}));
    const events=await query('SELECT t.*,a.email AS actor FROM cc_platform_audit t JOIN cc_accounts a ON a.id=t.actor_id ORDER BY t.created_at DESC,t.id LIMIT 51 OFFSET $1',[offset]);
    const counts=await query('SELECT status,COUNT(*) AS count FROM cc_company_status GROUP BY status');
    let detail=null;
    if(selection.organizationId){
      const row=await one('SELECT id,company,owner_id,data,revision FROM cc_organizations WHERE id=$1',[selection.organizationId]);requireValue(row,'Company unavailable.',404);
      const controls=await query('SELECT * FROM cc_campaign_controls WHERE organization_id=$1',[row.id]);
      detail={id:row.id,organizationRevision:row.revision,company:{...JSON.parse(row.company),legacyId:legacyCompany(row.id,row.owner_id)},ownerId:row.owner_id,...await application(identity,row.id,true),
        campaigns:JSON.parse(row.data).campaigns.map(c=>({id:c.id,legacyId:c.legacyId,name:c.name,status:c.status,...(controls.find(p=>p.campaign_id===c.id)||{visible:1,paused:0,revision:0})})),
        members:await query("SELECT m.account_id AS id,m.role,a.email,a.name,CASE WHEN c.archived=1 OR c.status='suspended' THEN 'removed' ELSE 'active' END AS account_status FROM cc_memberships m JOIN cc_accounts a ON a.id=m.account_id LEFT JOIN cc_account_controls c ON c.account_id=a.id WHERE m.organization_id=$1 ORDER BY m.created_at,m.account_id",[row.id]),
        invitations:await query("SELECT i.id,i.email,i.role,i.expires_at FROM cc_invitations i WHERE i.organization_id=$1 AND i.status='pending' AND i.expires_at>$2 ORDER BY i.created_at",[row.id,at()]),
        submissions:(await query('SELECT * FROM cc_company_submissions WHERE organization_id=$1 ORDER BY created_at DESC',[row.id])).map(s=>({...s,application:JSON.parse(s.application),documents:JSON.parse(s.documents)}))};
    }
    const accountInvitations=await query("SELECT id,email,created_at,expires_at FROM cc_account_invitations WHERE status='pending' AND expires_at>$1 ORDER BY created_at DESC LIMIT 50",[at()]);
    return {role,accountFilter,accountInvitations,companies:companies.slice(0,50).map(c=>({...c,company:JSON.parse(c.company)})),accounts:accountRows,audit:events.slice(0,50),settings:await settings(),counts:Object.fromEntries(counts.map(c=>[c.status,Number(c.count)])),company:detail,pagination:{page,companyMore:companies.length>50,accountMore:accounts.length>50,auditMore:events.length>50},search};
  }
  async function review(identity,cmd){
    const row=await status(cmd.organizationId);requireValue(row,'Company unavailable.',404);
    requireValue(Number.isInteger(cmd.revision)&&cmd.revision===row.revision,'The company changed. Reload and try again.',409);
    const note=typeof cmd.note==='string'?cmd.note.trim():'';requireValue(note.length>=3&&note.length<=1000,'Enter a reason (3–1,000 characters).');
    let next=row.status,visible=row.visible,wasApproved=row.was_approved,mode=row.approval_mode;
    if(cmd.action==='activate'){
      requireValue(row.status!=='approved'&&row.status!=='suspended','Only inactive companies can be activated.');next='approved';visible=0;wasApproved=1;mode='managed';
    }else if(cmd.action==='deactivate'){requireValue(row.status==='approved','Only active companies can be deactivated.');next='draft';visible=0;wasApproved=0;}
    else if(cmd.action==='suspend'){requireValue(row.status!=='suspended','Company is already suspended.');next='suspended';visible=0;}
    else if(cmd.action==='resume'){requireValue(row.status==='suspended','Only suspended companies can resume.');next=row.was_approved===1?'approved':'draft';visible=0;}
    else if(['hide','show'].includes(cmd.action)){requireValue(row.status==='approved','Only active companies can be listed.');visible=cmd.action==='show'?1:0;}
    else throw new PlatformError('Unknown review action.');
    checked(await DB.atomicChange(stmt(`UPDATE cc_company_status SET status=$1,visible=$2,was_approved=$3,approval_mode=$4,review_note=$5,reviewed_by=$6,reviewed_at=$7,revision=revision+1 WHERE organization_id=$8 AND revision=$9 AND ${adminGuard('$6')} RETURNING organization_id`,[next,visible,wasApproved,mode,note,identity.accountId,at(),row.organization_id,row.revision]),[
      stmt(`INSERT INTO cc_company_reviews (id,organization_id,application_revision,action,note,reviewed_by,created_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE ${changed} RETURNING id`,[randomUUID(),row.organization_id,row.revision,cmd.action,note,identity.accountId,at()]),
      audit(identity.accountId,'Company '+cmd.action,'company',row.organization_id,{from:row.status,to:next,visible,approvalMode:mode,note,revision:row.revision}),invalidate(row.organization_id)
    ]));return {view:'platform',organizationId:row.organization_id};
  }
  async function platformExecute(identity,cmd){
    const role=await requireAdmin(identity);
    // Old clients use the same single disable/restore path; no new suspended state.
    if(cmd.type==='platform-account-status'){
      requireValue(['active','suspended'].includes(cmd.status),'Invalid account status.');
      cmd={...cmd,type:cmd.status==='suspended'?'platform-remove-account':'platform-restore-account'};
    }
    if(cmd.type==='platform-invite-account'){
      const email=typeof cmd.email==='string'?cmd.email.trim().toLowerCase():'';requireValue(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email address.');
      requireValue(!await one('SELECT id FROM cc_accounts WHERE email=$1',[email]),'This account already exists. Manage or restore its portal access instead.',409);
      await query("UPDATE cc_account_invitations SET status='expired' WHERE email=$1 AND status='pending' AND expires_at<=$2",[email,at()]);
      const id=randomUUID(),expires=new Date(now().getTime()+7*86400000).toISOString();
      try{checked(await DB.atomicChange(stmt(`INSERT INTO cc_account_invitations (id,email,created_by,created_at,expires_at) SELECT $1,$2,$3,$4,$5 WHERE ${adminGuard('$3')} AND NOT EXISTS (SELECT 1 FROM cc_accounts WHERE email=$2) RETURNING id`,[id,email,identity.accountId,at(),expires]),[audit(identity.accountId,'Account invited','account-invitation',id,{email})]));}
      catch(error){if(error.code==='23505'||error.code==='ERR_SQLITE_ERROR'&&/UNIQUE/.test(error.message))throw new PlatformError('A pending invitation already exists for this email.',409);throw error;}
    }else if(cmd.type==='platform-revoke-account-invitation'){
      const row=await one("SELECT email FROM cc_account_invitations WHERE id=$1 AND status='pending'",[cmd.invitationId]);requireValue(row,'Pending invitation unavailable.',409);
      checked(await DB.atomicChange(stmt(`UPDATE cc_account_invitations SET status='revoked' WHERE id=$1 AND status='pending' AND ${adminGuard('$2')} RETURNING id`,[cmd.invitationId,identity.accountId]),[audit(identity.accountId,'Account invitation revoked','account-invitation',cmd.invitationId,{email:row.email})]));
    }else if(['platform-remove-account','platform-restore-account'].includes(cmd.type)){
      requireValue(cmd.accountId!==identity.accountId&&!await platformRole(cmd.accountId),'Revoke the platform role before disabling all portal access for this account. The platform owner and your own account are protected.',403);
      requireValue(await one('SELECT id FROM cc_accounts WHERE id=$1',[cmd.accountId]),'Account unavailable.',404);const reason=typeof cmd.note==='string'?cmd.note.trim():'';requireValue(reason.length>=3&&reason.length<=1000,'Enter a reason (3–1,000 characters).');
      await query("INSERT INTO cc_account_controls (account_id,status,updated_at) VALUES ($1,'active',$2) ON CONFLICT (account_id) DO NOTHING",[cmd.accountId,at()]);
      const remove=cmd.type==='platform-remove-account';
      const stateGuard=remove?"archived=0 AND status='active'":"(archived=1 OR status='suspended')";
      checked(await DB.atomicChange(stmt(`UPDATE cc_account_controls SET archived=$1,status='active',reason=$2,updated_by=$3,updated_at=$4,revision=revision+1 WHERE account_id=$5 AND revision=$6 AND ${stateGuard} AND NOT EXISTS (SELECT 1 FROM cc_platform_admins WHERE account_id=$5) AND ${adminGuard('$3')} RETURNING account_id`,[remove?1:0,reason,identity.accountId,at(),cmd.accountId,cmd.revision]),[audit(identity.accountId,remove?'Portal access disabled':'Portal access restored','account',cmd.accountId,{reason}),...(remove?[stmt(`UPDATE cc_invitations SET status='revoked' WHERE email=(SELECT email FROM cc_accounts WHERE id=$1) AND status='pending' AND ${changed} RETURNING id`,[cmd.accountId]),stmt(`UPDATE cc_wallet_challenges SET consumed_at=$1 WHERE account_id=$2 AND consumed_at IS NULL AND ${changed} RETURNING id`,[at(),cmd.accountId])]:[])]));
    }else if(cmd.type==='platform-save-company')return saveCompany(identity,cmd);
    else if(cmd.type==='platform-review-company')return review(identity,cmd);
    else if(cmd.type==='platform-settings'){
      requireValue(typeof cmd.shareholderRegistrations==='boolean','Invalid portal settings.');const announcement=typeof cmd.announcement==='string'?cmd.announcement.trim():'';requireValue(announcement.length<=300,'Portal notice must be 300 characters or fewer.');
      checked(await DB.atomicChange(stmt(`UPDATE cc_portal_settings SET company_applications=0,shareholder_registrations=$1,announcement=$2,revision=revision+1 WHERE id='portal' AND revision=$3 AND ${adminGuard('$4')} RETURNING id`,[cmd.shareholderRegistrations?1:0,announcement,cmd.revision,identity.accountId]),[audit(identity.accountId,'Portal settings updated','portal','portal',{shareholderRegistrations:cmd.shareholderRegistrations,announcement})]));
    }else if(cmd.type==='platform-admin-access'){
      requireValue(typeof cmd.grant==='boolean','Select an administrator access action.');
      requireValue(role==='owner','Only the platform owner can appoint administrators.',403);requireValue(cmd.accountId!==identity.accountId,'The platform owner cannot be changed.',403);requireValue(await one('SELECT id FROM cc_accounts WHERE id=$1',[cmd.accountId]),'Account unavailable.',404);await accountActive(cmd.accountId);
      const guard=`EXISTS (SELECT 1 FROM cc_platform_admins WHERE account_id=$2 AND role='owner') AND ${active('$2')}`;
      const change=cmd.grant===true?stmt(`INSERT INTO cc_platform_admins (account_id,role,granted_by,created_at) SELECT $1,'admin',$2,$3 WHERE ${guard} ON CONFLICT (account_id) DO NOTHING RETURNING account_id`,[cmd.accountId,identity.accountId,at()]):stmt(`DELETE FROM cc_platform_admins WHERE account_id=$1 AND role='admin' AND ${guard} RETURNING account_id`,[cmd.accountId,identity.accountId]);
      checked(await DB.atomicChange(change,[audit(identity.accountId,cmd.grant?'Platform admin granted':'Platform admin removed','account',cmd.accountId,'Owner-authorized administrator access')]));
    }else if(['platform-company-admin','platform-remove-company-member'].includes(cmd.type)){
      const memberId=cmd.memberId||(typeof cmd.memberEmail==='string'?(await one('SELECT id FROM cc_accounts WHERE email=$1',[cmd.memberEmail.trim().toLowerCase()]))?.id:null);
      requireValue(typeof memberId==='string'&&memberId!==identity.accountId,'Select another registered company member.',403);
      const org=await one('SELECT owner_id FROM cc_organizations WHERE id=$1',[cmd.organizationId]);requireValue(org&&org.owner_id!==memberId,'The company owner cannot be changed or removed.',403);
      const person=await one('SELECT email FROM cc_accounts WHERE id=$1',[memberId]);requireValue(person,'Registered account unavailable.',404);
      const current=await one('SELECT role FROM cc_memberships WHERE organization_id=$1 AND account_id=$2',[cmd.organizationId,memberId]);
      const remove=cmd.type==='platform-remove-company-member';
      if(remove||cmd.memberId)requireValue(current&&cmd.expectedRole===current.role,'The company role changed. Reload before updating access.',409);
      else requireValue(!current,'This account is already a member. Use Change role instead.',409);
      if(!remove){requireValue(['admin','operator','viewer'].includes(cmd.role),'Invalid company role.');await accountActive(memberId);}
      const note=typeof cmd.note==='string'?cmd.note.trim():'';if(remove)requireValue(note.length>=3&&note.length<=1000,'Enter a removal reason (3–1,000 characters).');
      const guard=`${adminGuard('$4')} AND NOT EXISTS (SELECT 1 FROM cc_organizations WHERE id=$1 AND owner_id=$2) AND $2<>$4`;
      const base=[cmd.organizationId,memberId,remove?current.role:cmd.role,identity.accountId];
      const change=remove?stmt(`DELETE FROM cc_memberships WHERE organization_id=$1 AND account_id=$2 AND role=$3 AND role<>'owner' AND ${guard} RETURNING account_id`,base):current?
        stmt(`UPDATE cc_memberships SET role=$3 WHERE organization_id=$1 AND account_id=$2 AND role=$5 AND role<>'owner' AND ${guard} AND ${active('$2')} RETURNING account_id`,[...base,current.role]):
        stmt(`INSERT INTO cc_memberships (organization_id,account_id,role,created_at) SELECT $1,$2,$3,$5 WHERE ${guard} AND ${active('$2')} ON CONFLICT (organization_id,account_id) DO NOTHING RETURNING account_id`,[...base,at()]);
      checked(await DB.atomicChange(change,[
        audit(identity.accountId,remove?'Company member removed':'Company member role set','company',cmd.organizationId,{member:memberId,email:person.email,role:remove?'removed':cmd.role,note}),
        stmt(`UPDATE cc_invitations SET status='revoked' WHERE organization_id=$1 AND email=$2 AND status='pending' AND ${changed} RETURNING id`,[cmd.organizationId,person.email]),
        stmt(`INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,[randomUUID(),cmd.organizationId,identity.accountId,remove?'Platform removed company member':'Platform updated member role',`${person.email} · ${remove?'removed':cmd.role}${note?' · '+note:''}`,at()])
      ]));return {view:'platform',organizationId:cmd.organizationId};
    }else if(cmd.type==='platform-revoke-company-invitation'){
      const invitation=await one("SELECT id,email,role FROM cc_invitations WHERE id=$1 AND organization_id=$2 AND status='pending'",[cmd.invitationId,cmd.organizationId]);requireValue(invitation,'Pending invitation unavailable.',409);
      checked(await DB.atomicChange(stmt(`UPDATE cc_invitations SET status='revoked' WHERE id=$1 AND organization_id=$2 AND status='pending' AND ${adminGuard('$3')} RETURNING id`,[cmd.invitationId,cmd.organizationId,identity.accountId]),[
        audit(identity.accountId,'Company invitation revoked','company',cmd.organizationId,{invitation:invitation.id,email:invitation.email,role:invitation.role}),
        stmt(`INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,[randomUUID(),cmd.organizationId,identity.accountId,'Platform revoked invitation',invitation.email,at()])
      ]));return {view:'platform',organizationId:cmd.organizationId};
    }else if(cmd.type==='platform-campaign-control'){
      requireValue(['hide','show','pause','resume'].includes(cmd.action),'Invalid campaign action.');const org=await one('SELECT data FROM cc_organizations WHERE id=$1',[cmd.organizationId]);requireValue(org&&JSON.parse(org.data).campaigns.some(c=>c.id===cmd.campaignId),'Campaign unavailable.',404);requireValue(!['archived','deleted'].includes(JSON.parse(org.data).campaigns.find(c=>c.id===cmd.campaignId).status),'Archived and deleted campaigns are read-only.');
      const reason=typeof cmd.note==='string'?cmd.note.trim():'';requireValue(reason.length>=3&&reason.length<=1000,'Enter a moderation reason (3–1,000 characters).');
      await query('INSERT INTO cc_campaign_controls (organization_id,campaign_id,updated_at) VALUES ($1,$2,$3) ON CONFLICT (organization_id,campaign_id) DO NOTHING',[cmd.organizationId,cmd.campaignId,at()]);
      const current=await one('SELECT * FROM cc_campaign_controls WHERE organization_id=$1 AND campaign_id=$2',[cmd.organizationId,cmd.campaignId]);
      const visible=['hide','show'].includes(cmd.action)?(cmd.action==='show'?1:0):current.visible,paused=['pause','resume'].includes(cmd.action)?(cmd.action==='pause'?1:0):current.paused;
      checked(await DB.atomicChange(stmt(`UPDATE cc_campaign_controls SET visible=$1,paused=$2,reason=$3,revision=revision+1,updated_by=$4,updated_at=$5 WHERE organization_id=$6 AND campaign_id=$7 AND revision=$8 AND ${adminGuard('$4')} RETURNING campaign_id`,[visible,paused,reason,identity.accountId,at(),cmd.organizationId,cmd.campaignId,cmd.revision]),[audit(identity.accountId,'Campaign '+cmd.action,'campaign',cmd.campaignId,{company:cmd.organizationId,reason}),invalidate(cmd.organizationId)]));return {view:'platform',organizationId:cmd.organizationId};
    }else throw new PlatformError('Unknown platform action.',400);
    return {view:'platform',accountFilter:cmd.accountFilter==='removed'?'removed':'current'};
  }
  return {accountActive,acceptAccountInvitations,platformRole,checkAccount,settings,status,application,documents,companyAccess,requireAdmin,platformRead,platformExecute,audit,invalidate,memberGuard,adminGuard};
}
