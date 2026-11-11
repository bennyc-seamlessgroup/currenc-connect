import {createHash} from 'node:crypto';
import {getAddress,isAddress} from 'viem';
import bs58 from 'bs58';
import {requireValue} from './errors.mjs';

export const AIRDROP_NETWORKS={ethereum:{label:'Ethereum',chain:'ETH',decimals:18},sepolia:{label:'Ethereum Sepolia',chain:'ETH',decimals:18},bnb:{label:'BNB Smart Chain',chain:'BNB',decimals:18},'bnb-testnet':{label:'BNB Testnet',chain:'BNB',decimals:18},solana:{label:'Solana',chain:'SOL',decimals:9},'solana-devnet':{label:'Solana Devnet',chain:'SOL',decimals:9}};
export const MAX_RECIPIENTS=5000,MAX_CSV_BYTES=1024*1024;
export function airdropAddress(value,network){
 requireValue(typeof value==='string'&&value.length<=64,'Enter a valid wallet or token address.');
 const address=value.trim(),config=AIRDROP_NETWORKS[network];requireValue(config,'Select a supported network.');
 if(config.chain!=='SOL'){
  requireValue(isAddress(address,{strict:true})&&!/^0x0{40}$/i.test(address),'Enter a valid, non-zero EVM address.');return getAddress(address);
 }
 let bytes;try{bytes=bs58.decode(address);}catch{}
 requireValue(bytes?.length===32&&bytes.some(b=>b!==0),'Enter a valid, non-zero Solana address.');return address;
}
export function tokenUnits(value,decimals){
 requireValue(typeof value==='string'&&value.length<=80&&/^(0|[1-9]\d*)(\.\d+)?$/.test(value),'Use a positive decimal token amount; no commas or scientific notation.');
 const [whole,fraction='']=value.split('.');requireValue(fraction.length<=decimals,`Token amounts support at most ${decimals} decimal places.`);
 const units=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 requireValue(units>0n&&units<2n**256n,'Token amount is outside the supported range.');return units;
}
export function formatUnits(units,decimals){const text=BigInt(units).toString().padStart(decimals+1,'0');return decimals?(text.slice(0,-decimals)+'.'+text.slice(-decimals)).replace(/\.?0+$/,''):text;}
export function parseRecipientCsv(csv,network,decimals,defaultAmount){
 requireValue(typeof csv==='string'&&Buffer.byteLength(csv)<=MAX_CSV_BYTES,'Upload a CSV file of 1 MB or less.',413);
 csv=csv.replace(/^\uFEFF/,'');requireValue(!csv.includes('\0'),'The CSV contains invalid characters.');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const endCell=()=>{row.push(cell);cell='';closed=false;requireValue(row.length<=3,'Use only wallet_address, amount and optional reference columns.');};
 const endRow=()=>{endCell();if(row.some(v=>v.trim()))rows.push(row);row=[];requireValue(rows.length<=MAX_RECIPIENTS+1,`Use at most ${MAX_RECIPIENTS.toLocaleString('en-US')} recipients per campaign.`);};
 for(let i=0;i<csv.length;i++){
  const ch=csv[i];
  if(quoted){if(ch==='"'){if(csv[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'){requireValue(!cell&&!closed,'The CSV has an invalid quoted field.');quoted=true;}
  else if(ch===',')endCell();
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&csv[i+1]==='\n')i++;endRow();}
  else{requireValue(!closed,'The CSV has text after a closing quote.');cell+=ch;}
 }
 requireValue(!quoted,'The CSV has an unclosed quoted field.');if(cell||row.length||closed)endRow();
 const header=rows.shift()?.map(v=>v.trim().toLowerCase());
 const perRow=header?.[1]==='amount';
 requireValue(header&&header[0]==='wallet_address'&&(perRow?(header.length===2||header.length===3&&header[2]==='reference'):(header.length===1||header.length===2&&header[1]==='reference')),'Use wallet_address,amount,reference, or wallet_address with an amount per wallet. Reference is optional.');
 if(!perRow)tokenUnits(defaultAmount,decimals);
 requireValue(rows.length>0,'The file has no recipients.');const seen=new Set();let total=0n;
 const recipients=rows.map((r,index)=>{
  try{
   requireValue(r.length===header.length,'The number of columns does not match the header.');
   const address=airdropAddress(r[0],network),key=AIRDROP_NETWORKS[network].chain==='SOL'?address:address.toLowerCase();
   requireValue(!seen.has(key),'Duplicate wallet address. Combine amounts into one row.');seen.add(key);
   const units=tokenUnits(perRow?r[1].trim():defaultAmount,decimals);total+=units;requireValue(total<2n**256n,'The total token amount is too large.');
   const reference=(r[perRow?2:1]||'').trim();requireValue(reference.length<=100&&!/[\r\n\x00-\x1f]/.test(reference),'Keep reference to 100 characters on one line.');
   return {address,amount:formatUnits(units,decimals),units:units.toString(),reference};
  }catch(error){error.message=`CSV row ${index+2}: ${error.message}`;throw error;}
 });
 return {recipients,totalUnits:total.toString(),total:formatUnits(total,decimals)};
}
export const manifestHash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
