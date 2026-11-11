import solc from 'solc';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
const file='contracts/CurrencTestAirdrop.sol';
const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
const input={language:'Solidity',sources:{[file]:{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{
 if(!path.startsWith('@openzeppelin/contracts/')||path.includes('..'))return {error:'Unsupported import'};
 try{return {contents:readFileSync(new URL('../node_modules/'+path,import.meta.url),'utf8')};}catch{return {error:'Missing dependency'};}
}}));
for(const error of output.errors||[])if(error.severity==='error')throw Error(error.formattedMessage);
const artifact=output.contracts[file].CurrencTestAirdrop;
await mkdir(new URL('../dist/contracts/',import.meta.url),{recursive:true});
await writeFile(new URL('../dist/contracts/CurrencTestAirdrop.json',import.meta.url),JSON.stringify({compiler:solc.version(),abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,runtime:'0x'+artifact.evm.deployedBytecode.object}));
console.log('Compiled Sepolia test airdrop contract.');
