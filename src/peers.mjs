import { randomInt } from 'node:crypto';
import { onionEndpoint,peerRequest,fetchPeerChain,fetchPending,submitTransaction,submitBlock } from './transport.mjs';
import { POOL_LIMIT } from './node.mjs';
import { sha } from './primitives.mjs';
import { downloadCandidate } from './synchronization.mjs';

export function validatePeers(peers) {
  if(!Array.isArray(peers)||peers.length>8||peers.some(p=>typeof p!=='string'))throw Error('At most eight explicitly configured onion peers are allowed');
  for(const peer of peers)onionEndpoint(peer);
  return [...new Set(peers)];
}

// Every request has fresh SOCKS isolation credentials; no origin identity is relayed.
export async function peerCycle(node,endpoint,options={}) {
  onionEndpoint(endpoint);
  const tip=await peerRequest(endpoint,{...options,path:'/tip',maxBytes:4096});
  if(tip.genesis!==node.chain.blocks[0].id||tip.protocol!==node.chain.config.protocol||
    !Number.isSafeInteger(tip.height)||tip.height<0||tip.height>3999999||
    typeof tip.work!=='string'||!/^(0|[1-9][0-9]{0,100})$/.test(tip.work))throw Error('Incompatible peer tip');
  let adopted=false,received=0,sent=0,blocksSent=0;
  if(BigInt(tip.work)>node.chain.work){const candidate=await downloadCandidate(endpoint,node.chain,{...options,candidateFile:node.chainFile+'.sync-candidate.json'});if(candidate)adopted=await node.importVerifiedCandidate(candidate);}
  const remote=await fetchPending(endpoint,options);
  if(!Array.isArray(remote.packets)||remote.packets.length>POOL_LIMIT)throw Error('Invalid peer pending list');
  for(const packet of remote.packets) {
    try{if((await node.acceptTransaction(packet)).accepted)received++;}catch{/* No unvalidated transaction is propagated. */}
  }
  const remoteIds=new Set(remote.packets.map(p=>sha(p.transaction)));
  for(const packet of node.packets()) {
    if(remoteIds.has(sha(packet.transaction)))continue;
    try{await submitTransaction(endpoint,packet,options);sent++;}catch{/* A conflicting or full peer may reject. */}
  }
  const chain=node.chain;
  if(chain.blocks[tip.height]?.id===tip.id) {
    for(const block of chain.blocks.slice(tip.height+1,tip.height+9)) {
      await submitBlock(endpoint,block,options);blocksSent++;
    }
  }
  return {adopted,received,sent,blocksSent};
}

export function followPeers(node,peers,{intervalMs=30000,proxyPort=9050,onStatus=()=>{}}={}) {
  peers=validatePeers(peers);
  if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>3600000)throw Error('Invalid peer interval');
  const controller=new AbortController();let stopped=false,timer,wake;
  const done=(async()=>{
    while(!stopped&&peers.length) {
      for(const peer of peers) {
        if(stopped)break;
        try{onStatus({ok:true,...await peerCycle(node,peer,{proxyPort,signal:controller.signal})});}
        catch{if(!stopped)onStatus({ok:false});}
      }
      if(!stopped)await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,intervalMs+randomInt(Math.max(1,Math.floor(intervalMs/5))));});
    }
  })();
  return {stop:async()=>{stopped=true;controller.abort();clearTimeout(timer);wake?.();await done;}};
}
