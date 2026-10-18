import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJSON,readJSON } from './storage.mjs';
const ID=/^[a-f0-9]{64}$/;
let lastFile,lastBlock;
function archived(file){if(lastFile!==file){lastBlock=JSON.parse(readFileSync(file,'utf8'));lastFile=file;}return lastBlock;}
export function pruneProofs(block,file){
  for(let i=0;i<block.transactions.length;i++){
    const proof=block.transactions[i].proof;
    Object.defineProperty(proof,'bytes',{enumerable:true,configurable:true,get:()=>archived(file).transactions[i].proof.bytes});
  }
}
export async function saveBlockDirectory(chain,file){
  const directory=path.resolve(file+'.blocks');await fs.mkdir(directory,{recursive:true,mode:0o700});
  chain.archivePaths??=new Map();
  try{for(const block of chain.blocks){
    if(!ID.test(block.id))throw Error('Invalid stored block id');const target=path.join(directory,block.id+'.json');
    if(chain.archivePaths.get(block.id)===target)continue;
    if(!await fs.access(target).then(()=>true,()=>false))await writeJSON(target,block,0o600,{replace:false});
    chain.archivePaths.set(block.id,target);
  }}catch(error){error.replacementVisible=false;throw error;}
  // Only the index replacement makes additional blocks part of the durable chain.
  await writeJSON(file,{format:'onlyprivacy-block-directory-v1',config:chain.config,blockIds:chain.blocks.map(b=>b.id)});
  for(const block of chain.blocks)pruneProofs(block,chain.archivePaths.get(block.id));
}
export async function readBlockIndex(file){
  const data=await readJSON(file,256*1024*1024);
  if(data.format!=='onlyprivacy-block-directory-v1')return {legacy:data};
  if(Object.keys(data).sort().join(',')!=='blockIds,config,format'||!Array.isArray(data.blockIds)||!data.blockIds.length||data.blockIds.length>4000000||data.blockIds.some(id=>typeof id!=='string'||!ID.test(id)))throw Error('Invalid chain directory index');
  return {config:data.config,ids:data.blockIds,directory:path.resolve(file+'.blocks')};
}
export async function readArchivedBlock(directory,id){return readJSON(path.join(directory,id+'.json'),24*1024*1024);}
