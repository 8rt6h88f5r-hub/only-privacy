import fs from 'node:fs/promises';
import { Chain } from './chain.mjs';
import { peerRequest } from './transport.mjs';
import { canonical } from './primitives.mjs';
// Downloads bounded block ranges. Proofs are archived while catching up, not held as a giant JSON response.
export async function downloadCandidate(endpoint,checkpoint,{candidateFile,...options}={}){
 const tip=await peerRequest(endpoint,{...options,path:'/tip',maxBytes:4096});
 if(tip.genesis!==checkpoint.blocks[0].id||tip.protocol!==checkpoint.config.protocol||!Number.isSafeInteger(tip.height)||tip.height<0||tip.height>3999999||typeof tip.work!=='string'||!/^\d{1,100}$/.test(tip.work))throw Error('Different or invalid peer network');
 if(BigInt(tip.work)<=checkpoint.work)return null;
 const range=async(from,count=2)=>{
  const data=await peerRequest(endpoint,{...options,path:'/range?from='+from+'&count='+count,maxBytes:49*1024*1024});
  if(data.genesis!==tip.genesis||data.configuration!==checkpoint.blocks[0].header.configuration||!Array.isArray(data.blocks)||data.blocks.length>count)throw Error('Invalid block range');return data.blocks;
 };
 let candidate;
 if(candidateFile&&await fs.access(candidateFile).then(()=>true,()=>false)){
  const saved=await Chain.load(candidateFile);
  if(canonical(saved.config)===canonical(checkpoint.config)&&saved.blocks[0].id===tip.genesis&&saved.height<=tip.height&&(await range(saved.height,1))[0]?.id===saved.blocks.at(-1).id)candidate=saved;else saved.close();
 }
 if(!candidate){
  const same=tip.height>=checkpoint.height&&(await range(checkpoint.height,1))[0]?.id===checkpoint.blocks.at(-1).id;
  candidate=same?checkpoint.fork():new Chain(structuredClone(checkpoint.config));
 }
 try{
  while(candidate.height<tip.height){
   const blocks=await range(candidate.height+1);if(!blocks.length)throw Error('Incomplete peer chain');
   for(const block of blocks){if(candidate.height===-1&&block.id!==checkpoint.blocks[0].id)throw Error('Different genesis checkpoint');await candidate.append(block);}
   if(candidateFile)await candidate.save(candidateFile);
  }
  if(candidate.blocks[0].id!==checkpoint.blocks[0].id||candidate.blocks.at(-1).id!==tip.id||candidate.work.toString()!==tip.work)throw Error('Peer tip changed; retry');
  return candidate;
 }catch(error){candidate.close();throw error;}
}
