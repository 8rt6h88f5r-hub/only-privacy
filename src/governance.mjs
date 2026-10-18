import { sha } from './primitives.mjs';
import { randomBytes } from 'node:crypto';
import { UNIT } from './emission.mjs';
export const UPGRADE_SUITES=Object.freeze({1:{kem:'ml-kem-768',level:3},2:{kem:'ml-kem-1024',level:5}});
export function proposalId(p) {const {id,...body}=p;return sha(body);}
export function proposalAction(chain,targetSuite=2,height=chain.blocks.length) {
  const closeHeight=height+chain.config.governance.votingBlocks;
  const action={type:'proposal',targetSuite,closeHeight,activationHeight:closeHeight+chain.config.governance.activationDelay,nonce:randomBytes(32).toString('hex')};
  return {...action,id:proposalId(action)};
}
export function suiteAt(proposals,config,height) {
  let suite=2;
  for(const p of proposals.values()) {
    if(height>=p.activationHeight&&p.yes+p.no>=config.governance.quorumVotes&&p.yes*3>=(p.yes+p.no)*2) suite=Math.max(suite,p.targetSuite);
  }
  return suite;
}
export function validateGovernance(action,signals,state,config,height) {
  if(action.type==='payment') {
    if(Object.keys(action).join(',')!=='type'||signals.stake!=='0'||signals.stakeLock!==0)throw Error('Unexpected payment stake');return;
  }
  if(action.type==='proposal') {
    if(Object.keys(action).sort().join(',')!=='activationHeight,closeHeight,id,nonce,targetSuite,type')throw Error('Invalid proposal fields');
    if(action.id!==proposalId(action)||state.has(action.id))throw Error('Invalid or duplicate proposal');
    if(!Number.isInteger(action.targetSuite)||!UPGRADE_SUITES[action.targetSuite]||action.targetSuite<=suiteAt(state,config,height))throw Error('Unknown or non-increasing crypto suite');
    if(action.closeHeight!==height+config.governance.votingBlocks||action.activationHeight!==action.closeHeight+config.governance.activationDelay)throw Error('Invalid activation schedule');
    if(signals.stake!==UNIT.toString()||signals.stakeLock!==action.closeHeight)throw Error('Proposal must lock one coin');
    state.set(action.id,{...action,yes:0,no:0});return;
  }
  if(action.type==='vote') {
    if(Object.keys(action).sort().join(',')!=='choice,proposal,type')throw Error('Invalid ballot fields');
    const p=state.get(action.proposal);
    if(!p||height>=p.closeHeight||!['yes','no'].includes(action.choice))throw Error('Unknown or closed ballot');
    if(signals.stake!==UNIT.toString()||signals.stakeLock!==p.closeHeight)throw Error('Each ballot must lock one coin until voting closes');
    p[action.choice]++;return;
  }
  throw Error('Unsupported transaction action');
}
