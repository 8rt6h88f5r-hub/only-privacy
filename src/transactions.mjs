import { randomBytes } from 'node:crypto';
import { DEPTH,randomField,ownerOf,commitment,fieldHash,uint,field,nullifier,bindingOf } from './primitives.mjs';
import { sealNote,SUITES } from './envelopes.mjs';
import { prove,decodeSignals } from './proofs.mjs';
import { FEE } from './emission.mjs';
export async function buildTransaction(chain,wallet,{recipient,amount,mint=0n,action={type:'payment'},stake=0n,stakeLock=0,height=chain.blocks.length,inputs=null,memo=''}) {
  const domain=chain.config.domain,suite=chain.activeSuite(height),fee=action.type==='mint'?0n:FEE;
  if(recipient.domain!==domain||recipient.protocol!=='onlyprivacy-invoice-v1'||recipient.suite!==suite||!SUITES[suite])throw Error('Invoice belongs to another network or inactive suite');
  field(recipient.owner);uint(amount.toString());
  wallet.scan(chain);
  const selected=inputs??(mint>0n?[]:wallet.select(amount+fee,height));
  const total=selected.reduce((s,n)=>s+BigInt(n.value),mint);
  if(total<amount+fee)throw Error('Insufficient balance');
  const change=wallet.invoice(domain,suite);
  const out=[{owner:recipient.owner,value:amount.toString(),rho:randomField(),lock:String(stakeLock),memo},
    {owner:change.owner,value:(total-amount-fee).toString(),rho:randomField(),lock:'0',memo:''}];
  const commitments=out.map(n=>commitment(n,domain));
  const external={version:1,domain,suite,height,nonce:randomBytes(32).toString('hex'),action,envelopes:[sealNote(out[0],recipient,domain,commitments[0]),sealNote(out[1],change,domain,commitments[1])]};
  const padded=[...selected];while(padded.length<2)padded.push({secret:randomField(),rho:randomField(),value:'0',lock:'0',position:-1});
  if(padded.length!==2)throw Error('Two input limit');
  const paths=padded.map(n=>n.position<0?{siblings:Array(DEPTH).fill('0'),pathBits:Array(DEPTH).fill(0)}:chain.tree.path(n.position));
  const witness={domain,root:chain.tree.root,mint:mint.toString(),fee:fee.toString(),extHash:fieldHash(external),height:String(height),stake:stake.toString(),stakeLock:String(stakeLock),
    inSecret:padded.map(n=>n.secret),inRho:padded.map(n=>n.rho),inValue:padded.map(n=>n.value),inLock:padded.map(n=>n.lock),siblings:paths.map(p=>p.siblings),pathBits:paths.map(p=>p.pathBits),
    outOwner:out.map(n=>n.owner),outRho:out.map(n=>n.rho),outValue:out.map(n=>n.value),outLock:out.map(n=>n.lock)};
  const publicSignals=[...padded.map(n=>n.value==='0'?'0':nullifier(n,domain)),...commitments,
    bindingOf(out[0].rho,witness.extHash,chain.tree.root,domain,height),domain,chain.tree.root,mint.toString(),fee.toString(),witness.extHash,String(height),stake.toString(),String(stakeLock)];
  const {proof}=await prove({publicSignals,witness});
  const s=decodeSignals(publicSignals);
  if(s.commitments.join(',')!==commitments.join(','))throw Error('Circuit/commitment mismatch');
  if(action.type!=='mint')wallet.consumeInvoice(recipient);
  return {external,proof,publicSignals};
}
export async function rewardTransaction(chain,wallet,value,height=chain.blocks.length) {
  const recipient=wallet.invoice(chain.config.domain,chain.activeSuite(height));
  return buildTransaction(chain,wallet,{recipient,amount:value,mint:value,action:{type:'mint'},height,inputs:[]});
}
