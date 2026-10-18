import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT,proofInfo } from './proofs.mjs';
export async function checkArtifacts(){
  const manifest=JSON.parse(await fs.readFile(path.join(PROJECT,'pq/proof-program.json'),'utf8')),checks=[];
  for(const [file,hash] of Object.entries(manifest.hashes)){
    const actual=createHash('sha256').update(await fs.readFile(path.join(PROJECT,file))).digest('hex');checks.push({file,ok:actual===hash});
  }
  const info=await proofInfo();checks.push({file:'native fixed program digest',ok:JSON.stringify(info.programDigest)===JSON.stringify(manifest.programDigest)&&info.securityParameter===160&&info.trustedSetup===false});
  return {ok:checks.every(c=>c.ok),checks,coin:'온리프라이버시 / OnlyPrivacy',stage:'experimental-post-quantum-stark-network',independentAudit:false,productionReady:false,
    administratorKey:false,globalDecryptionKey:false,trustedSetup:false,proofSystem:'Triton VM 9 / zero-knowledge hash-based STARK',postQuantumDesign:true,
    securityParameter:160,absoluteQuantumSecurityProof:false,setup:'transparent; no Groth16 or elliptic-curve verification key',
    consensus:'Every node checks pinned genesis, monetary constants, proof program, reserve release and valid work; developer has no forced-update key'};
}
export async function checkPrivateFile(file){const stat=await fs.stat(file);return process.platform==='win32'||(stat.mode&0o077)===0;}
