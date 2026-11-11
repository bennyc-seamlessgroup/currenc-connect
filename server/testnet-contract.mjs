import {readFile} from 'node:fs/promises';
import {encodeAbiParameters,encodeDeployData,encodeFunctionData,keccak256,concat,getAddress,parseUnits,formatUnits} from 'viem';
export const TESTNET_CHAIN_ID=11155111;
export const TESTNET_EXPLORER='https://sepolia.etherscan.io';
let artifact;
export async function testnetArtifact(){return artifact||(artifact=JSON.parse(await readFile(new URL('../dist/contracts/CurrencTestAirdrop.json',import.meta.url),'utf8')));}
export const units=number=>parseUnits(String(number),6);
export const tokens=number=>Number(formatUnits(BigInt(number),6));
export function allocationTree(holders){
 const rows=holders.filter(h=>h.status==='verified'&&h.allocation>0).sort((a,b)=>a.id.localeCompare(b.id)).map((h,index)=>({holderId:h.id,accountId:h.accountId,index,address:getAddress(h.wallet),amount:units(h.allocation).toString()}));
 if(!rows.length)throw Error('No positive allocations.');
 const leaf=row=>keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'}],[BigInt(row.index),row.address,BigInt(row.amount)])));
 const levels=[rows.map(leaf)];
 const pair=(a,b)=>keccak256(concat(a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]));
 while(levels.at(-1).length>1){const next=[],current=levels.at(-1);for(let i=0;i<current.length;i+=2)next.push(current[i+1]?pair(current[i],current[i+1]):current[i]);levels.push(next);}
 rows.forEach((row,index)=>{const proof=[];for(let level=0;level<levels.length-1;level++){const sibling=index^1;if(sibling<levels[level].length)proof.push(levels[level][sibling]);index=Math.floor(index/2);}row.proof=proof;});
 return {root:levels.at(-1)[0],total:rows.reduce((sum,r)=>sum+BigInt(r.amount),0n).toString(),rows};
}
export async function deploymentData(campaign,tree){
 const {abi,bytecode}=await testnetArtifact();
 const deadline=BigInt(Math.floor(Date.parse((campaign.claimDeadline||campaign.deadline)+'T00:00:00Z')/1000)+86400);
 return encodeDeployData({abi,bytecode,args:[campaign.name+' Test',campaign.token,tree.root,deadline,BigInt(tree.total)]});
}
export async function claimData(row){return encodeFunctionData({abi:(await testnetArtifact()).abi,functionName:'claim',args:[BigInt(row.index),BigInt(row.amount),row.proof]});}
export async function pauseData(value){return encodeFunctionData({abi:(await testnetArtifact()).abi,functionName:'setPaused',args:[value]});}
