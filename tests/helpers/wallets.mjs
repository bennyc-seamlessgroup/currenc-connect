import {randomBytes} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {ed25519} from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import {createWallets} from '../../server/wallets.mjs';
// Ephemeral test keys never leave the test process or enter the application bundle.
export function testSigner(chain='ETH'){
 const secret=randomBytes(32);
 if(chain==='SOL'){const address=bs58.encode(ed25519.getPublicKey(secret));return {address,async sign(message){return '0x'+Buffer.from(ed25519.sign(Buffer.from(message,'utf8'),secret)).toString('hex');}};}
 const account=privateKeyToAccount('0x'+secret.toString('hex'));return {address:account.address,sign:message=>account.signMessage({message})};
}
export async function verifiedTestWallet(DB,platform,actor,chain='ETH'){
 const signer=testSigner(chain),identity={...actor,sessionHash:'isolated-test-session-binding-for-'+actor.accountId},service=createWallets(DB,platform),origin='https://wallet.example.test';
 const challenge=await service.challenge(identity,origin,{chain,address:signer.address}),wallet=await service.verify(identity,origin,{challengeId:challenge.id,signature:await signer.sign(challenge.message)});
 return {...wallet,walletId:wallet.id,walletRevision:wallet.revision};
}
