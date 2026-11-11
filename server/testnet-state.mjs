export async function testnetSummaries(DB,campaigns){
 const ids=campaigns.filter(c=>c.delivery==='sepolia').map(c=>c.id);let rows=[];
 for(let offset=0;offset<ids.length;offset+=500){const batch=ids.slice(offset,offset+500);rows.push(...await DB.query(`SELECT c.campaign_id,c.contract_address,c.deployment_block,i.status,i.tx_hash,i.sender FROM cc_testnet_campaigns c JOIN cc_testnet_intents i ON i.id=c.deployment_id WHERE c.campaign_id IN (${batch.map((_,i)=>'$'+(i+1)).join(',')})`,batch));}
 return campaigns.map(c=>{if(c.delivery!=='sepolia')return c;const row=rows.find(r=>r.campaign_id===c.id);return {...c,testnet:{chainId:11155111,status:row?.status||'not_deployed',contract:row?.contract_address||null,hash:row?.tx_hash||null,controller:row?.sender||null}};});
}
