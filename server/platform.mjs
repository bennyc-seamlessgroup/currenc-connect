import {createHash,randomUUID} from 'node:crypto';
import {applyCommand,COMPANIES} from '../dist/server/domain.mjs';
import {PlatformError,requireValue} from './errors.mjs';
import {createGovernance,validateCompanyInfo} from './governance.mjs';

export {PlatformError} from './errors.mjs';
const blankProfile=()=>({name:'',email:'',country:'Hong Kong',kyc:false});
const emptyState=profile=>({version:2,profile,companies:[],campaigns:[],holders:[],transactions:[],activity:[],treasury:{}});
const json=JSON.stringify;
const domainCommand=(...args)=>{try{return applyCommand(...args);}catch(error){throw new PlatformError(error.message);}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const statement=(sql,values=[])=>({sql,values});
const parse=row=>JSON.parse(row.data);
const label=(value,name,max=80)=>{requireValue(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,`Enter a valid ${name}.`);return value.trim();};
const roles=['admin','operator','viewer'];
export const permissions=role=>({campaigns:['owner','admin','operator'].includes(role),treasury:['owner','admin'].includes(role),team:['owner','admin'].includes(role),lifecycle:['owner','admin'].includes(role),owner:role==='owner'});
const commandRoles={'edit-campaign':['owner','admin','operator'],'delete-draft':['owner','admin'],'restore-draft':['owner','admin'],'archive-campaign':['owner','admin'],create:['owner','admin','operator'],open:['owner','admin','operator'],review:['owner','admin','operator'],snapshot:['owner','admin','operator'],pause:['owner','admin','operator'],release:['owner','admin','operator'],fund:['owner','admin'],distribute:['owner','admin']};
const publicCampaign=c=>Object.fromEntries(['id','company','name','description','token','status','mode','ratio','budget','minimum','cap','release','chains','snapshotDate','deadline','registrationDeadline','claimDeadline','distribution','snapshotAt'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
const projectHolder=(h,accountId)=>{const {accountId:owner,...safe}=h;return {...safe,self:owner===accountId};};
const teamGuard=`EXISTS (SELECT 1 FROM cc_memberships actor WHERE actor.organization_id=$1 AND actor.account_id=$2 AND (actor.role='owner' OR (actor.role='admin' AND $3<>'admin'))) AND NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=$2 AND (status='suspended' OR archived=1)) AND NOT EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$1 AND status='suspended')`;

export function createPlatform(DB,{now=()=>new Date(),bootstrapOwner}={}) {
  const query=(sql,values=[])=>DB.query(sql,values);
  const one=async(sql,values=[]) => (await query(sql,values))[0]||null;
  const at=()=>now().toISOString();
  const governance=createGovernance(DB,{now,bootstrapOwner});
  const teamAudit=(organization,actor,action,detail)=>statement('INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),organization,actor,action,detail,at()]);

  async function ensureAccount(identity) {
    const {accountId,user}=identity;
    let account=await one('SELECT * FROM cc_accounts WHERE id=$1',[accountId]);
    if(!account) {
      const legacy=await DB.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(accountId).first();
      const old=legacy?JSON.parse(legacy.data):null;
      const steps=[statement('INSERT INTO cc_accounts (id,email,name,profile,activity,onboarded,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',[accountId,user.email.toLowerCase(),user.name||'',json(old?.profile||blankProfile()),json(old?.activity||[]),old?1:0,at()])];
      if(old)for(const company of old.companies||COMPANIES) {
        const organizationId='org-'+hash(accountId+'\0'+company.id).slice(0,32);
        const meta={...company,id:organizationId,legacyId:company.id};
        const campaigns=old.campaigns.filter(c=>c.company===company.id);
        const campaignIds=new Map(campaigns.map(c=>[c.id,organizationId+'--'+c.id]));
        const holders=old.holders.filter(h=>campaignIds.has(h.campaign));
        const holderIds=new Map(holders.map(h=>[h.id,organizationId+'--'+h.id]));
        const data={...emptyState(blankProfile()),companies:[meta],
          campaigns:campaigns.map(c=>({...c,legacyId:c.id,id:campaignIds.get(c.id),company:organizationId})),
          holders:holders.map(h=>({...h,legacyId:h.id,id:holderIds.get(h.id),campaign:campaignIds.get(h.campaign),...(h.id===`self-${h.campaign}`?{accountId}:{})})),
          transactions:old.transactions.filter(t=>campaignIds.has(t.campaign)).map(t=>({...t,legacyId:t.id,id:organizationId+'--'+t.id,campaign:campaignIds.get(t.campaign),holder:holderIds.get(t.holder)})),
          // Old events lack company IDs. Keep them in the owner's personal archive,
          // never copy other companies' historical details to newly invited members.
          activity:[],
          treasury:{[organizationId]:old.treasury[company.id]||{ETH:0,SOL:0,BNB:0}}};
        steps.push(statement('INSERT INTO cc_organizations (id,company,data,revision,owner_id,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',[organizationId,json(meta),json(data),legacy.revision,accountId,at()]));
        steps.push(statement("INSERT INTO cc_memberships (organization_id,account_id,role,created_at) VALUES ($1,$2,'owner',$3) ON CONFLICT (organization_id,account_id) DO NOTHING",[organizationId,accountId,at()]));
        steps.push(statement('INSERT INTO cc_company_status (organization_id,created_at) VALUES ($1,$2) ON CONFLICT (organization_id) DO NOTHING',[organizationId,at()]));
      }
      // The original JSON row is left intact as a migration archive. A transaction
      // prevents partially imported companies or memberships on interrupted requests.
      await DB.transaction(steps);
    }
    await query('UPDATE cc_accounts SET email=$1,name=$2 WHERE id=$3',[user.email.trim().toLowerCase(),user.name||'',accountId]);
    await governance.checkAccount(identity);
    if(!account)await governance.acceptAccountInvitations(identity);
    return one('SELECT * FROM cc_accounts WHERE id=$1',[accountId]);
  }
  async function organizations(accountId) {
    return (await query('SELECT o.id,o.company,m.role,s.status AS approval_status,s.visible FROM cc_organizations o JOIN cc_memberships m ON m.organization_id=o.id JOIN cc_company_status s ON s.organization_id=o.id WHERE m.account_id=$1 ORDER BY o.created_at,o.id',[accountId])).map(row=>({...JSON.parse(row.company),role:row.role,approvalStatus:row.approval_status,listed:row.visible===1}));
  }
  async function organization(organizationId,accountId,memberRequired=true) {
    const row=await one('SELECT o.*,m.role FROM cc_organizations o LEFT JOIN cc_memberships m ON m.organization_id=o.id AND m.account_id=$2 WHERE o.id=$1',[organizationId,accountId]);
    requireValue(row&&(!memberRequired||row.role),'You do not have access to this company.',403);
    return row;
  }
  async function pendingInvitations(email) {
    return (await query("SELECT i.id,i.role,i.expires_at,o.company,a.email AS inviter FROM cc_invitations i JOIN cc_organizations o ON o.id=i.organization_id JOIN cc_accounts a ON a.id=i.invited_by WHERE i.email=$1 AND i.status='pending' AND i.expires_at>$2 ORDER BY i.created_at",[email.toLowerCase(),at()])).map(({company,...row})=>({...row,company:JSON.parse(company).name}));
  }
  async function team(organizationId) {
    return {members:await query('SELECT m.account_id AS id,m.role,a.email,a.name FROM cc_memberships m JOIN cc_accounts a ON a.id=m.account_id WHERE m.organization_id=$1 ORDER BY m.created_at,m.account_id',[organizationId]),
      invitations:await query("SELECT id,email,role,expires_at FROM cc_invitations WHERE organization_id=$1 AND status='pending' AND expires_at>$2 ORDER BY created_at",[organizationId,at()]),
      audit:await query('SELECT t.action,t.detail,t.created_at,a.email AS actor FROM cc_team_audit t JOIN cc_accounts a ON a.id=t.actor_id WHERE t.organization_id=$1 ORDER BY t.created_at DESC LIMIT 30',[organizationId])};
  }
  async function read(identity,selection={}) {
    const account=await ensureAccount(identity);
    const [memberships,invitations]=await Promise.all([organizations(identity.accountId),pendingInvitations(account.email)]);
    const mode=selection.view|| (memberships.length?'company':'shareholder');
    requireValue(['company','shareholder','platform'].includes(mode),'Unknown workspace view.',400);
    let state=emptyState(JSON.parse(account.profile));
    let context={mode,organizationId:null,role:'shareholder',permissions:permissions('shareholder')};
    let revision=account.revision,teamData=null,companyApplication=null,platformData=null;
    const portal=await governance.settings(),platformRole=await governance.platformRole(identity.accountId);
    if(mode==='platform'){
      platformData=await governance.platformRead(identity,selection);
      context={mode,organizationId:null,role:platformRole,permissions:{platform:true,platformOwner:platformRole==='owner'}};
    }
    else if(mode==='company') {
      const id=selection.organizationId||memberships.find(o=>o.legacyId==='curr')?.id||memberships[0]?.id;
      requireValue(id,'Your team must provide company access first.',403);
      const row=await organization(id,identity.accountId);
      state={...parse(row),profile:JSON.parse(account.profile)};
      state.holders=state.holders.map(h=>projectHolder(h,identity.accountId));
      const approval=await governance.status(id),approved=approval.status==='approved',suspended=approval.status==='suspended';
      const grants=permissions(row.role);
      context={mode,organizationId:id,role:row.role,approvalStatus:approval.status,listed:approval.visible===1,permissions:{...grants,campaigns:grants.campaigns&&!suspended,publish:grants.campaigns&&approved,treasury:grants.treasury&&approved,team:grants.team&&!suspended,lifecycle:grants.lifecycle&&!suspended}};
      const controls=await query('SELECT campaign_id,visible,paused FROM cc_campaign_controls WHERE organization_id=$1',[id]);
      state.campaigns=state.campaigns.map(c=>({...c,platform:{companyStatus:approval.status,listed:approval.visible===1,...(controls.find(p=>p.campaign_id===c.id)||{visible:1,paused:0})}}));
      revision=row.revision;
      if(context.permissions.team)teamData=await team(id);
    }else {
      const all=await query('SELECT o.id,o.company,o.data,s.status AS approval_status,s.visible FROM cc_organizations o JOIN cc_company_status s ON s.organization_id=o.id ORDER BY o.created_at,o.id');
      const controls=await query('SELECT organization_id,campaign_id,visible,paused FROM cc_campaign_controls');
      for(const row of all) {
        const data=parse(row),mine=data.holders.filter(h=>h.accountId===identity.accountId);
        const moderation=c=>controls.find(p=>p.organization_id===row.id&&p.campaign_id===c.id)||{visible:1,paused:0};
        const visible=data.campaigns.filter(c=>(row.approval_status==='approved'&&row.visible===1&&moderation(c).visible===1&&!['draft','closed','archived','deleted'].includes(c.status))||mine.some(h=>h.campaign===c.id));
        if(!visible.length)continue;
        state.companies.push(JSON.parse(row.company));state.campaigns.push(...visible.map(c=>({...publicCampaign(c),platform:{companyStatus:row.approval_status,listed:row.visible===1,...moderation(c)}})));
        state.holders.push(...mine.map(h=>projectHolder(h,identity.accountId)));
        state.transactions.push(...data.transactions.filter(t=>mine.some(h=>h.id===t.holder)));
      }
      state.activity=JSON.parse(account.activity);
    }
    return {state,revision,accountRevision:account.revision,context,team:teamData,companyApplication,platform:platformData,access:{onboarded:account.onboarded===1,organizations:memberships,invitations,platformRole,portal:{shareholderRegistrations:portal.shareholder_registrations===1,announcement:portal.announcement}}};
  }
  async function createOrganization(identity,cmd) {
    await governance.requireAdmin(identity);
    const name=label(cmd.name,'company name');
    const ticker=label(cmd.ticker,'ticker',12).toUpperCase();const token=label(cmd.token,'test token symbol',12);
    requireValue(/^[A-Z0-9.-]{1,12}$/.test(ticker)&&/^[A-Za-z0-9.-]{1,12}$/.test(token),'Use letters, numbers, dots or hyphens for symbols.');
    const id=randomUUID();const company={id,name,ticker,token,color:'#39796f',initials:name.slice(0,1).toUpperCase(),description:'',sector:'Company workspace'};
    const state={...emptyState(blankProfile()),companies:[company],treasury:{[id]:{ETH:0,SOL:0,BNB:0}}};
    const info=validateCompanyInfo(cmd.info||{}),changed='EXISTS (SELECT 1 FROM changed)';
    const rows=await DB.atomicChange(statement(`INSERT INTO cc_organizations (id,company,data,owner_id,created_at) SELECT $1,$2,$3,$4,$5 WHERE ${governance.adminGuard('$4')} RETURNING id`,[id,json(company),json(state),identity.accountId,at()]),[
      statement(`INSERT INTO cc_memberships (organization_id,account_id,role,created_at) SELECT $1,$2,'owner',$3 WHERE ${changed} RETURNING account_id`,[id,identity.accountId,at()]),
      statement(`INSERT INTO cc_company_status (organization_id,status,was_approved,visible,application,created_at) SELECT $1,'approved',1,0,$2,$3 WHERE ${changed} RETURNING organization_id`,[id,json(info),at()]),
      statement(`UPDATE cc_accounts SET onboarded=1 WHERE id=$1 AND ${changed} RETURNING id`,[identity.accountId]),
      governance.audit(identity.accountId,'Company created','company',id,{name,ticker}),
      statement(`INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE ${changed} RETURNING id`,[randomUUID(),id,identity.accountId,'Company created by platform',name,at()])
    ]);
    requireValue(rows.length,'Your platform access changed. Reload and try again.',403);
    return {view:'platform',organizationId:id};
  }
  async function invite(identity,cmd) {
    const row=await organization(cmd.organizationId,identity.accountId);
    requireValue(permissions(row.role).team,'Only company administrators can invite members.',403);
    requireValue((await governance.status(row.id)).status!=='suspended','Company operations are suspended.',403);
    requireValue(roles.includes(cmd.role),'Select a valid member role.');
    requireValue(row.role==='owner'||cmd.role!=='admin','Only the owner can appoint administrators.',403);
    const email=label(cmd.email,'email address',254).toLowerCase();
    requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email address.');
    requireValue(!await one('SELECT m.account_id FROM cc_memberships m JOIN cc_accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND a.email=$2',[row.id,email]),'This person is already a company member.');
    const id=randomUUID(),expiry=new Date(now().getTime()+7*86400000).toISOString();
    try {
      const results=await DB.transaction([
        statement("UPDATE cc_invitations SET status='expired' WHERE organization_id=$1 AND email=$2 AND status='pending' AND expires_at<=$3",[row.id,email,at()]),
        statement(`INSERT INTO cc_invitations (id,organization_id,email,role,invited_by,status,created_at,expires_at) SELECT $4,$1,$5,$3,$2,'pending',$6,$7 WHERE ${teamGuard} RETURNING id`,[row.id,identity.accountId,cmd.role,id,email,at(),expiry]),
        statement('INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM cc_invitations WHERE id=$7)',[randomUUID(),row.id,identity.accountId,'Member invited',`${email} · ${cmd.role}`,at(),id])
      ]);
      requireValue(results[1].length,'Your company access has changed.',403);
    }catch(error){if(error.code==='23505'||error.code==='ERR_SQLITE_ERROR'&&/UNIQUE/.test(error.message))throw new PlatformError('A pending invitation already exists for this email.',409);throw error;}
  }
  async function accept(identity,account,cmd) {
    const nonce=randomUUID();
    const results=await DB.transaction([
      statement("UPDATE cc_invitations SET status='accepted',accepted_by=$1,accept_nonce=$2 WHERE id=$3 AND email=$4 AND status='pending' AND expires_at>$5 AND NOT EXISTS (SELECT 1 FROM cc_company_status s WHERE s.organization_id=cc_invitations.organization_id AND s.status='suspended') AND NOT EXISTS (SELECT 1 FROM cc_account_controls c WHERE c.account_id=cc_invitations.invited_by AND (c.status='suspended' OR c.archived=1)) RETURNING organization_id",[identity.accountId,nonce,cmd.invitationId,account.email,at()]),
      statement("INSERT INTO cc_memberships (organization_id,account_id,role,created_at) SELECT organization_id,$1,role,$2 FROM cc_invitations WHERE id=$3 AND accept_nonce=$4 AND status='accepted' AND accepted_by=$1 ON CONFLICT (organization_id,account_id) DO NOTHING",[identity.accountId,at(),cmd.invitationId,nonce]),
      statement("UPDATE cc_accounts SET onboarded=1 WHERE id=$1 AND EXISTS (SELECT 1 FROM cc_invitations WHERE id=$2 AND accept_nonce=$3)",[identity.accountId,cmd.invitationId,nonce]),
      statement('INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,organization_id,$2,$3,$4,$5 FROM cc_invitations WHERE id=$6 AND accept_nonce=$7',[randomUUID(),identity.accountId,'Invitation accepted',account.email,at(),cmd.invitationId,nonce])
    ]);
    requireValue(results[0].length,'This invitation is unavailable, expired, or belongs to another email.',403);
    return {view:'company',organizationId:results[0][0].organization_id};
  }
  async function manageTeam(identity,cmd) {
    const row=await organization(cmd.organizationId,identity.accountId);
    requireValue(permissions(row.role).team,'Only company administrators can manage members.',403);
    requireValue((await governance.status(row.id)).status!=='suspended','Company operations are suspended.',403);
    if(cmd.type==='revoke-invitation') {
      const result=await DB.mutateWithAudit(statement(`UPDATE cc_invitations SET status='revoked' WHERE organization_id=$1 AND id=$3 AND status='pending' AND ${teamGuard.replaceAll('$3',"cc_invitations.role")} RETURNING id`,[row.id,identity.accountId,cmd.invitationId]),teamAudit(row.id,identity.accountId,'Invitation revoked',cmd.invitationId));
      requireValue(result.length,'This invitation cannot be revoked.',403);
      return;
    }
    const target=await one('SELECT m.*,a.email FROM cc_memberships m JOIN cc_accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.account_id=$2',[row.id,cmd.memberId]);
    requireValue(target&&target.role!=='owner','The company owner cannot be changed or removed.',403);
    requireValue(cmd.memberId!==identity.accountId,'You cannot change your own company membership.',403);
    requireValue(row.role==='owner'||target.role!=='admin','Only the owner can manage administrators.',403);
    if(cmd.type==='change-member-role') {
      requireValue(roles.includes(cmd.role),'Select a valid member role.');
      requireValue(row.role==='owner'||cmd.role!=='admin','Only the owner can appoint administrators.',403);
    }
    const guard=`EXISTS (SELECT 1 FROM cc_memberships actor WHERE actor.organization_id=$1 AND actor.account_id=$2 AND (actor.role='owner' OR (actor.role='admin' AND cc_memberships.role<>'admin' AND $4<>'admin'))) AND NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=$2 AND (status='suspended' OR archived=1)) AND NOT EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$1 AND status='suspended')`;
    const sql=cmd.type==='remove-member'?`DELETE FROM cc_memberships WHERE organization_id=$1 AND account_id=$3 AND role<>'owner' AND account_id<>$2 AND ${guard} RETURNING account_id`:`UPDATE cc_memberships SET role=$4 WHERE organization_id=$1 AND account_id=$3 AND role<>'owner' AND account_id<>$2 AND ${guard} RETURNING account_id`;
    const rows=await DB.mutateWithAudit(statement(sql,[row.id,identity.accountId,cmd.memberId,cmd.role||'viewer']),teamAudit(row.id,identity.accountId,cmd.type==='remove-member'?'Member removed':'Member role changed',`${target.email}${cmd.role?' · '+cmd.role:''}`));
    requireValue(rows.length,'Your company access has changed.',403);
  }
  async function execute(identity,cmd) {
    const account=await ensureAccount(identity);
    requireValue(cmd&&typeof cmd==='object'&&!Array.isArray(cmd),'Invalid command.',400);
    if(cmd.type==='platform-create-company')return createOrganization(identity,cmd);
    if(typeof cmd.type==='string'&&cmd.type.startsWith('platform-'))return governance.platformExecute(identity,cmd);
    if(['create-organization','save-company-application','submit-company-application'].includes(cmd.type))throw new PlatformError('Companies are registered and managed by the platform team.',403);
    if(cmd.type==='onboard') {await query('UPDATE cc_accounts SET onboarded=1 WHERE id=$1',[identity.accountId]);return {view:'shareholder'};}
    if(cmd.type==='accept-invitation')return accept(identity,account,cmd);
    if(cmd.type==='invite-member'){await invite(identity,cmd);return {view:'company',organizationId:cmd.organizationId};}
    if(['revoke-invitation','change-member-role','remove-member'].includes(cmd.type)){await manageTeam(identity,cmd);return {view:'company',organizationId:cmd.organizationId};}
    if(cmd.type==='kyc') {
      for(let retry=0;retry<4;retry++) {
        const current=await one('SELECT * FROM cc_accounts WHERE id=$1',[identity.accountId]);
        const next=domainCommand(emptyState(JSON.parse(current.profile)),cmd,now());
        const activity=[...next.activity,...JSON.parse(current.activity)].slice(0,100);
        const result=await query('UPDATE cc_accounts SET profile=$1,activity=$2,revision=revision+1 WHERE id=$3 AND revision=$4 RETURNING revision',[json(next.profile),json(activity),identity.accountId,current.revision]);
        if(result.length)return {view:'shareholder'};
      }throw new PlatformError('Your profile changed. Please try again.',409);
    }
    const isShareholder=['verify','wallet','claim'].includes(cmd.type);
    requireValue(isShareholder||Object.hasOwn(commandRoles,cmd.type),'This action is not available.',403);
    requireValue(typeof cmd.organizationId==='string','Select a company.',400);
    for(let retry=0;retry<4;retry++) {
      const row=await organization(cmd.organizationId,identity.accountId,!isShareholder);
      const allowed=commandRoles[cmd.type];
      if(!isShareholder)requireValue(allowed.includes(row.role),'Your company role does not allow this action.',403);
      const current=parse(row);
      const approval=await governance.status(row.id);
      const campaignRef=cmd.campaignId||(cmd.type==='review'?current.holders.find(h=>h.id===cmd.holderId)?.campaign:null)||'';
      const moderation=campaignRef?await one('SELECT * FROM cc_campaign_controls WHERE organization_id=$1 AND campaign_id=$2',[row.id,campaignRef]):null;
      requireValue(approval.status!=='suspended','Company operations are suspended.',403);
      const management=['create','edit-campaign','delete-draft','restore-draft','archive-campaign'].includes(cmd.type);
      if(!management)requireValue(approval.status==='approved','The company must be activated by the platform team first.',403);
      if(moderation?.paused===1)requireValue(cmd.type==='wallet'||management,'This campaign has been paused by the platform.',403);
      if(cmd.type==='verify'){
        requireValue(approval.visible===1&&moderation?.visible!==0,'This campaign is not accepting public registrations.',403);
        requireValue((await governance.settings()).shareholder_registrations===1,'New shareholder registrations are currently paused.',403);
      }
      if(cmd.type==='create')requireValue(cmd.input?.company===row.id,'Invalid company.',403);
      if(cmd.type==='fund')requireValue(cmd.company===row.id,'Invalid company.',403);
      if(cmd.campaignId)requireValue(current.campaigns.some(c=>c.id===cmd.campaignId&&c.company===row.id),'Campaign unavailable.',403);
      if(isShareholder)requireValue(current.campaigns.some(c=>c.id===cmd.campaignId&&c.status!=='draft'),'Campaign unavailable.',403);
      if(cmd.type==='review')requireValue(current.holders.some(h=>h.id===cmd.holderId),'Shareholder unavailable.',403);
      if(['edit-campaign','delete-draft','restore-draft','archive-campaign'].includes(cmd.type)){
        const campaign=current.campaigns.find(c=>c.id===cmd.campaignId);
        requireValue(campaign&&Number.isInteger(cmd.campaignRevision)&&cmd.campaignRevision===(campaign.revision||0),'The campaign changed. Reload before updating it.',409);
      }
      const next=domainCommand(current,cmd,now(),{accountId:identity.accountId,profile:JSON.parse(account.profile)});
      if(next.activity[0]?.id!==current.activity[0]?.id)next.activity[0]={...next.activity[0],actor:identity.user.email};
      const guard=(isShareholder?'':` AND EXISTS (SELECT 1 FROM cc_memberships WHERE organization_id=$2 AND account_id=$4 AND role IN (${allowed.map(role=>`'${role}'`).join(',')}))`)+` AND NOT EXISTS (SELECT 1 FROM cc_account_controls WHERE account_id=$4 AND (status='suspended' OR archived=1)) AND EXISTS (SELECT 1 FROM cc_company_status WHERE organization_id=$2 AND ${management?"status<>'suspended'":"status='approved'"}${cmd.type==='verify'?' AND visible=1':''})${cmd.type==='wallet'||management?'':" AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$2 AND campaign_id=$5 AND paused=1)"}${cmd.type==='verify'?" AND NOT EXISTS (SELECT 1 FROM cc_campaign_controls WHERE organization_id=$2 AND campaign_id=$5 AND visible=0) AND EXISTS (SELECT 1 FROM cc_portal_settings WHERE id='portal' AND shareholder_registrations=1)":''}`;
      const values=[json(next),row.id,row.revision,identity.accountId];if(cmd.type!=='wallet'&&!management)values.push(campaignRef);
      const update=statement(`UPDATE cc_organizations SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3${guard} RETURNING revision`,values);
      const audited=['edit-campaign','delete-draft','restore-draft','archive-campaign'].includes(cmd.type);
      const detail={campaign:campaignRef,name:next.campaigns.find(c=>c.id===campaignRef)?.name,action:cmd.type,...(cmd.input?{fields:Object.keys(cmd.input)}:{})};
      const result=audited?await DB.atomicChange(update,[
        governance.audit(identity.accountId,'Campaign '+cmd.type,'company',row.id,detail),
        statement('INSERT INTO cc_team_audit (id,organization_id,actor_id,action,detail,created_at) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM changed) RETURNING id',[randomUUID(),row.id,identity.accountId,'Campaign '+cmd.type,JSON.stringify(detail),at()])
      ]):await query(update.sql,update.values);
      if(result.length)return {view:isShareholder?'shareholder':'company',organizationId:isShareholder?undefined:row.id};
    }
    throw new PlatformError('The workspace changed. Reload and try again.',409);
  }
  return {read,execute,ensureAccount,governance};
}
