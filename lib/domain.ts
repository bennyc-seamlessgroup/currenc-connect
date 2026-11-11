export type Chain = 'ETH' | 'SOL' | 'BNB';
export type Campaign = {
  id: string; company: string; name: string; description: string; token: string;
  status: 'draft' | 'open' | 'locked' | 'paused' | 'closed' | 'archived' | 'deleted';
  mode: 'ratio' | 'pool'; ratio: number; budget: number; minimum: number; cap: number;
  release: number; chains: Chain[]; snapshotDate: string; deadline: string;
  distribution: 'claim' | 'push'; snapshotAt?: string;
  registrationDeadline?: string; claimDeadline?: string; revision?: number; archivedAt?: string; deletedAt?: string;
};
export type Holder = {
  id: string; campaign: string; name: string; shares: number;
  accountId?: string;
  status: 'verified' | 'pending' | 'needs_info' | 'rejected'; allocation: number; claimed: number;
  evidence?: {id:string;version:number};
  chain?: Chain; wallet?: string; source: string; asOf: string;
};
export type Entry = { id: string; at: string; title: string; detail: string; kind: 'info' | 'success' | 'warning' };
export type Transaction = { id: string; campaign: string; holder: string; chain: Chain; amount: number; wallet: string; at: string; status: 'simulated' };
export type State = {
  companies?: Company[];
  version: number; profile: { name: string; email: string; country: string; kyc: boolean };
  campaigns: Campaign[]; holders: Holder[]; transactions: Transaction[]; activity: Entry[];
  treasury: Record<string, Record<Chain, number>>;
};
export type Company = {id:string;name:string;ticker:string;token:string;color:string;description:string;sector:string;initials:string};
export const COMPANIES: Company[] = [
  { id: 'curr', name: 'CURRENC Group', ticker: 'CURR', token: 'uCURR', color: '#147d76', description: 'Shareholder rewards from CURRENC Group.', sector: 'Financial technology', initials: 'C' },
  { id: 'north', name: 'Northstar Labs', ticker: 'NRTH', token: 'NOVA', color: '#7960b8', description: 'Technology shareholder rewards demo.', sector: 'Technology · fictional company', initials: 'N' },
  { id: 'harbor', name: 'Harbor Energy', ticker: 'HBR', token: 'HBR', color: '#b17935', description: 'Energy shareholder rewards demo.', sector: 'Energy · fictional company', initials: 'H' },
];
export const CHAIN_NAMES: Record<Chain, string> = { ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB Chain' };
export function seedState(): State {
  const now = new Date();
  const future = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const base = { mode: 'ratio' as const, ratio: 0.1, budget: 100000, minimum: 100, cap: 10000, release: 100, chains: ['ETH', 'SOL', 'BNB'] as Chain[], snapshotDate: today, deadline: future(30), distribution: 'claim' as const };
  return {
    version: 1, profile: { name: '', email: '', country: 'Hong Kong', kyc: false },
    campaigns: [
      { ...base, id: 'curr-welcome', company: 'curr', name: 'Shareholder Welcome Rewards', token: 'uCURR', status: 'open', description: 'Register eligible shares for the first shareholder rewards campaign.' },
      { ...base, id: 'curr-loyalty', company: 'curr', name: 'Loyalty Rewards', token: 'uCURR', status: 'draft', release: 25, ratio: 0.2, description: 'Shareholder rewards with phased unlocking.' },
      { ...base, id: 'north-welcome', company: 'north', name: 'Northstar Pioneer Rewards', token: 'NOVA', status: 'open', ratio: 0.5, description: 'Register your shares for Northstar rewards.' },
      { ...base, id: 'harbor-welcome', company: 'harbor', name: 'Green Future Rewards', token: 'HBR', status: 'open', ratio: 0.25, description: 'Register your shares for Harbor rewards.' },
    ],
    holders: [
      { id: 'sample-grace', campaign: 'curr-welcome', name: 'Grace Wong', shares: 12000, status: 'verified', allocation: 0, claimed: 0, chain: 'ETH', wallet: '0x1111111111111111111111111111111111111111', source: 'Demo broker API', asOf: today },
      { id: 'sample-marcus', campaign: 'curr-welcome', name: 'Marcus Lee', shares: 8000, status: 'verified', allocation: 0, claimed: 0, chain: 'SOL', wallet: '11111111111111111111111111111111', source: 'Demo broker API', asOf: today },
      { id: 'sample-iris', campaign: 'curr-welcome', name: 'Iris Chan', shares: 5000, status: 'pending', allocation: 0, claimed: 0, chain: 'BNB', wallet: '0x2222222222222222222222222222222222222222', source: 'Demo statement · manual review', asOf: today },
      { id: 'sample-theo', campaign: 'curr-welcome', name: 'Theo Lam', shares: 20000, status: 'verified', allocation: 0, claimed: 0, chain: 'ETH', wallet: '0x3333333333333333333333333333333333333333', source: 'Demo share register', asOf: today },
    ], transactions: [],
    activity: [{ id: 'seed', at: now.toISOString(), title: 'Workspace ready', detail: 'Loaded 3 companies and 4 sample shareholders.', kind: 'info' }],
    treasury: { curr: { ETH: 25000, SOL: 25000, BNB: 25000 }, north: { ETH: 25000, SOL: 25000, BNB: 25000 }, harbor: { ETH: 25000, SOL: 25000, BNB: 25000 } },
  };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function numeric(value: unknown, name: string, min: number, max: number) {
  const n = Number(value); assert(Number.isFinite(n) && n >= min && n <= max, `${name} must be between ${min} and ${max}`); return n;
}
function label(value: unknown, name: string, max = 120) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Enter a valid ${name}`); return value.trim(); }
export const floorToken = (n: number) => Math.floor((n + Number.EPSILON) * 1000000) / 1000000;
export const claimable = (c: Campaign, h: Holder) => Math.max(0, floorToken(h.allocation * c.release / 100 - h.claimed));
export function validateWallet(chain: Chain, wallet: string) {
  return chain === 'SOL' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) : /^0x[0-9a-fA-F]{40}$/.test(wallet);
}
export function allocate(c: Campaign, holders: Holder[]) {
  const eligible = holders.filter(h => h.campaign === c.id && h.status === 'verified' && h.shares >= c.minimum);
  const total = eligible.reduce((s, h) => s + h.shares, 0);
  assert(total > 0, 'No verified shareholders meet the minimum holding requirement.');
  const result = eligible.map(h => ({ id: h.id, amount: floorToken(Math.min(c.cap, c.mode === 'pool' ? c.budget * h.shares / total : h.shares * c.ratio)) }));
  assert(result.reduce((s, r) => s + r.amount, 0) <= c.budget + 0.000001, 'Allocation exceeds the campaign budget. Adjust the budget or ratio.');
  return result;
}
export const registrationEnd = (c: Campaign) => c.registrationDeadline || c.deadline;
export const claimEnd = (c: Campaign) => c.claimDeadline || c.deadline;
function dateValue(value: unknown) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter valid dates.');
  const date = new Date(value + 'T00:00:00Z');assert(Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value, 'Enter valid dates.');return value;
}
function campaignSettings(input: Record<string, any>, companies: Company[], today: string) {
  const company = companies.find(c => c.id === input.company);assert(company, 'Select a company.');
  assert(input.mode === 'ratio' || input.mode === 'pool', 'Invalid allocation method');
  assert(input.distribution === 'claim' || input.distribution === 'push', 'Invalid distribution method');
  assert(Array.isArray(input.chains) && input.chains.length > 0 && input.chains.every((c: string) => ['ETH','SOL','BNB'].includes(c)), 'Select at least one supported network.');
  const snapshotDate = dateValue(input.snapshotDate), registrationDeadline = dateValue(input.registrationDeadline || input.deadline), claimDeadline = dateValue(input.claimDeadline || input.deadline || registrationDeadline);
  assert(registrationDeadline >= snapshotDate && registrationDeadline >= today && claimDeadline >= registrationDeadline, 'Registration must end on or after the record date and today; claims must end on or after registration.');
  return {company:company.id,token:company.token,name:label(input.name,'Campaign name',70),description:label(input.description,'Description',400),mode:input.mode as Campaign['mode'],ratio:numeric(input.ratio,'Tokens per share',0.000001,1000000),budget:numeric(input.budget,'Budget',1,1000000000),minimum:numeric(input.minimum,'Minimum shares',1,10000000),cap:numeric(input.cap,'Token cap',0.000001,1000000000),release:numeric(input.release,'Unlock percentage',0,100),chains:[...new Set(input.chains)] as Chain[],snapshotDate,registrationDeadline,claimDeadline,deadline:claimDeadline,distribution:input.distribution as Campaign['distribution']};
}
export function applyCommand(current: State, raw: unknown, now = new Date(), actor?: {accountId:string;profile:State['profile']}): State {
  assert(raw && typeof raw === 'object', 'Invalid command');
  const cmd = raw as Record<string, any>;
  const s = structuredClone(current);
  const companies = s.companies || COMPANIES;
  const own = (h: Holder, c: Campaign) => actor ? h.accountId === actor.accountId && h.campaign === c.id : h.id === `self-${c.id}`;
  const profile = actor?.profile || s.profile;
  const at = now.toISOString();
  const log = (title: string, detail: string, kind: Entry['kind'] = 'success') => { s.activity.unshift({ id: crypto.randomUUID(), at, title, detail, kind }); s.activity = s.activity.slice(0, 100); };
  const campaign = () => { const c = s.campaigns.find(c => c.id === cmd.campaignId); assert(c, 'Campaign not found'); return c; };
  const beforeDeadline = (c: Campaign, claims=false) => assert(at.slice(0,10) <= (claims?claimEnd(c):registrationEnd(c)), claims?'The claim deadline has passed.':'The registration deadline has passed.');
  const target = s.campaigns.find(c => c.id === (cmd.campaignId || s.holders.find(h => h.id === cmd.holderId)?.campaign));
  if(target && ['archived','deleted'].includes(target.status))assert(cmd.type === 'restore-draft' && target.status === 'deleted', 'Archived and deleted campaigns are read-only.');
  if(['edit-campaign','delete-draft','restore-draft','archive-campaign'].includes(cmd.type))assert(target && Number.isInteger(cmd.campaignRevision) && cmd.campaignRevision === (target.revision || 0), 'The campaign changed. Reload before updating it.');
  switch (cmd.type) {
    case 'reset': return seedState();
    case 'kyc': {
      const name = label(cmd.name, 'Demo name', 60); const email = label(cmd.email, 'Test email', 120);
      assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Invalid email format');
      assert(['Hong Kong', 'Taiwan', 'Singapore', 'United States', 'Other', '\u9999\u6e2f', '\u53f0\u7063', '\u65b0\u52a0\u5761', '\u7f8e\u570b', '\u5176\u4ed6'].includes(cmd.country), 'Select a country or region.');
      assert(cmd.consent === true, 'Confirm that you are using test data.');
      s.profile = { name, email, country: cmd.country, kyc: true };
      log('Demo identity completed', `${name} · Simulated KYC completed`); break;
    }
    case 'verify': {
      const c = campaign(); beforeDeadline(c); assert(c.status === 'open', 'Only open campaigns accept registrations.');
      assert(profile.kyc, 'Complete demo KYC first.');
      assert(!s.holders.some(h => own(h,c)), 'Duplicate registration is not allowed.');
      const shares = numeric(cmd.shares, 'Shares', 1, 10000000); assert(Number.isInteger(shares), 'Shares must be whole numbers.');
      assert(shares >= c.minimum, `Below the minimum shares requirement (${c.minimum}  shares)`);
      assert(['broker', 'register', 'manual'].includes(cmd.source), 'Select a verification source.');
      const source = cmd.source === 'manual' ? 'Demo statement · manual review' : cmd.source === 'register' ? 'Demo share register' : 'Demo broker API';
      s.holders.push({ id: actor ? crypto.randomUUID() : `self-${c.id}`, ...(actor?{accountId:actor.accountId}:{}), campaign: c.id, name: profile.name, shares, status: cmd.source === 'manual' ? 'pending' : 'verified', allocation: 0, claimed: 0, source, asOf: c.snapshotDate });
      log('Shareholder registered', `${profile.name} · ${c.name} · ${shares.toLocaleString()} shares (demo)`); break;
    }
    case 'review': {
      const h = s.holders.find(h => h.id === cmd.holderId); assert(h, 'Shareholder not found');
      const c = s.campaigns.find(c => c.id === h.campaign)!; assert(c.status === 'open', 'Eligibility cannot change after the snapshot is locked.');
      assert(!h.evidence, 'Review the current evidence version using the document review form.');
      assert(h.status === 'pending', 'This application has already been reviewed.'); h.status = cmd.approved === true ? 'verified' : 'rejected';
      log('Holdings review updated', `${h.name} · ${h.status === 'verified' ? 'Approved' : 'Rejected'} (demo review)`); break;
    }
    case 'wallet': {
      const c = campaign(); const h = s.holders.find(h => own(h,c)); assert(h, 'Register holdings first.');
      assert(c.chains.includes(cmd.chain), 'This network is not supported by the campaign.'); assert(h.claimed === 0, 'The receiving network cannot change after a claim.');
      const wallet = label(cmd.wallet, 'Wallet address', 60); assert(validateWallet(cmd.chain, wallet), 'Invalid wallet address format');
      h.chain = cmd.chain; h.wallet = wallet; log('Demo wallet saved', `${CHAIN_NAMES[h.chain!]} · Address format checked only`); break;
    }
    case 'create': {
      const settings = campaignSettings(cmd.input || {}, companies, at.slice(0,10));
      s.campaigns.unshift({id:crypto.randomUUID(),...settings,status:'draft',revision:0});
      log('Campaign draft created', `${settings.name} · Registration not yet open`);break;
    }
    case 'edit-campaign': {
      const c = campaign(), input = cmd.input || {};
      if(c.status === 'draft'){
        assert(!s.holders.some(h => h.campaign === c.id) && !s.transactions.some(t => t.campaign === c.id), 'A draft with registration or distribution records cannot change its rules.');
        assert(input.company === c.company, 'A campaign cannot move to another company.');
        assert(Object.keys(input).every(k => ['company','name','description','mode','ratio','budget','minimum','cap','release','chains','snapshotDate','deadline','registrationDeadline','claimDeadline','distribution'].includes(k)), 'Unsupported campaign setting.');
        Object.assign(c, campaignSettings(input, companies, at.slice(0,10)));
      }else{
        const allowed = c.status === 'open' ? ['name','description','registrationDeadline','claimDeadline'] : ['description'];
        assert(['open','locked','paused'].includes(c.status) && Object.keys(input).every(k => allowed.includes(k)), 'Published reward rules are locked. Create a new campaign to change them.');
        if(Object.hasOwn(input,'name'))c.name = label(input.name,'Campaign name',70);
        if(Object.hasOwn(input,'description'))c.description = label(input.description,'Description',400);
        const registration = Object.hasOwn(input,'registrationDeadline')?dateValue(input.registrationDeadline):registrationEnd(c);
        const claims = Object.hasOwn(input,'claimDeadline')?dateValue(input.claimDeadline):claimEnd(c);
        assert(registration >= registrationEnd(c) && claims >= claimEnd(c) && claims >= registration, 'Published deadlines can only be extended; claims must end on or after registration.');
        c.registrationDeadline=registration;c.claimDeadline=claims;c.deadline=claims;
      }
      log('Campaign updated', `${c.name} · ${Object.keys(input).join(', ')}`);break;
    }
    case 'delete-draft': {
      const c=campaign();assert(c.status==='draft' && !s.holders.some(h=>h.campaign===c.id) && !s.transactions.some(t=>t.campaign===c.id), 'Only unused drafts can be deleted. Archive published campaigns instead.');
      c.status='deleted';c.deletedAt=at;log('Campaign draft deleted', `${c.name} · Can be restored from Deleted`,'warning');break;
    }
    case 'restore-draft': {
      const c=campaign();assert(c.status==='deleted','Only deleted drafts can be restored.');c.status='draft';delete c.deletedAt;log('Campaign draft restored',c.name);break;
    }
    case 'archive-campaign': {
      const c=campaign(),rows=s.holders.filter(h=>h.campaign===c.id);
      assert(['open','locked','paused','closed'].includes(c.status),'Only published campaigns can be archived.');
      assert(!(c.status==='open' && rows.length),'Lock the snapshot and settle registered shareholders before archiving.');
      assert(rows.every(h=>floorToken(h.allocation-h.claimed)<=0),'Settle all allocated rewards before archiving.');
      c.status='archived';c.archivedAt=at;log('Campaign archived',`${c.name} · Registrations, allocations and transactions retained`);break;
    }
    case 'open': { const c = campaign(); assert(c.status === 'draft', 'Only draft campaigns can be opened.'); beforeDeadline(c); c.status = 'open'; log('Registration opened', c.name); break; }
    case 'snapshot': {
      const c = campaign(); assert(c.status === 'open', 'The campaign must be open.'); beforeDeadline(c,true);
      assert(c.snapshotDate <= at.slice(0, 10), 'The record date has not been reached.');
      const rows = s.holders.filter(h => h.campaign === c.id);
      assert(rows.every(h => !['pending','needs_info'].includes(h.status)), 'Complete all pending reviews first.');
      const amounts = allocate(c, rows); rows.forEach(h => h.allocation = amounts.find(r => r.id === h.id)?.amount || 0);
      c.status = 'locked'; c.snapshotAt = at;
      log('Snapshot locked', `${c.name} · ${amounts.length} eligible shareholders · allocations fixed`); break;
    }
    case 'pause': { const c = campaign(); assert(c.status === 'locked' || c.status === 'paused', 'Only locked campaigns can be paused or resumed.'); c.status = c.status === 'locked' ? 'paused' : 'locked'; log(c.status === 'paused' ? 'Distributions paused' : 'Distributions resumed', c.name, 'info'); break; }
    case 'release': { const c = campaign(); assert(c.status === 'locked' || c.status === 'paused', 'Lock the snapshot first.'); const value = numeric(cmd.percent, 'Unlock percentage', c.release, 100); c.release = value; log('Unlock updated', `${c.name} · Total unlocked: ${value}%`); break; }
    case 'fund': { assert(companies.some(c => c.id === cmd.company) && ['ETH','SOL','BNB'].includes(cmd.chain), 'Invalid company or network'); const amount = numeric(cmd.amount, 'Funding amount', 1, 100000000); s.treasury[cmd.company][cmd.chain as Chain] += amount; log('Test funds added', `${cmd.amount.toLocaleString()} ${companies.find(c => c.id === cmd.company)!.token} · ${CHAIN_NAMES[cmd.chain as Chain]}`); break; }
    case 'claim':
    case 'distribute': {
      const c = campaign(); assert(c.status === 'locked', 'Lock the snapshot and ensure the campaign is not paused.'); beforeDeadline(c,true);
      assert(cmd.type === 'claim' ? c.distribution === 'claim' : c.distribution === 'push', 'This action is not supported by the distribution method.');
      const rows = s.holders.filter(h => h.campaign === c.id && h.status === 'verified' && (cmd.type === 'distribute' || own(h,c)));
      const ready = rows.filter(h => claimable(c, h) > 0 && h.wallet && h.chain && c.chains.includes(h.chain));
      assert(ready.length > 0, 'No claimable allocation or receiving wallet.');
      const totals = { ETH: 0, SOL: 0, BNB: 0 };
      ready.forEach(h => totals[h.chain!] += claimable(c, h));
      (Object.keys(totals) as Chain[]).forEach(chain => assert(s.treasury[c.company][chain] + 0.000001 >= totals[chain], `${CHAIN_NAMES[chain]} has insufficient test funds.`));
      ready.forEach(h => { const amount = claimable(c, h); h.claimed = floorToken(h.claimed + amount); s.treasury[c.company][h.chain!] = floorToken(s.treasury[c.company][h.chain!] - amount); s.transactions.unshift({ id: `SIM-${crypto.randomUUID()}`, campaign: c.id, holder: h.id, chain: h.chain!, amount, wallet: h.wallet!, at, status: 'simulated' }); });
      log('Simulated distribution completed', `${c.name} · ${ready.length} shareholders · no on-chain transfer`); break;
    }
    default: throw new Error('Unsupported command');
  }
  if(target && ['edit-campaign','delete-draft','restore-draft','archive-campaign','open','snapshot','pause','release'].includes(cmd.type))target.revision=(target.revision||0)+1;
  return s;
}
