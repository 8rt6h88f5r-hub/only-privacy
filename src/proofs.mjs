import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { field,uint,sha,digestWords } from './primitives.mjs';
export const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const layout=JSON.parse(await fs.readFile(path.join(PROJECT,'pq/witness-layout.json'),'utf8'));
const engine=path.join(PROJECT,'native/onlyprivacy-pq');
function request(input){return new Promise((resolve,reject)=>{
  const child=spawn(engine,[],{cwd:PROJECT,env:{RAYON_NUM_THREADS:'2'},stdio:['pipe','pipe','pipe']});
  let data='';const timer=setTimeout(()=>{child.kill();reject(Error('STARK operation timeout'));},600000);
  child.stdout.on('data',c=>{data+=c;if(data.length>8*1024*1024)child.kill();});child.stderr.resume();
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('STARK proof or witness rejected'));try{resolve(JSON.parse(data));}catch{reject(Error('Invalid STARK response'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
});}
const publicFields=signals=>signals.flatMap(s=>digestWords(s).map(String));
export async function prove({publicSignals,witness},op='prove'){
  decodeSignals(publicSignals);
  const secretInput=layout.privateLayout.flatMap(({name,numeric})=>{
    const value=name.split('.').reduce((o,k)=>o[k],witness);return numeric?[uint(String(value)).toString()]:digestWords(value).map(String);
  });
  const proof=await request({op,publicInput:publicFields(publicSignals),secretInput});return {proof,publicSignals};
}
const cache=new Map();
export async function verify(proof,signals){
  try{
    decodeSignals(signals);if(proof?.system!=='triton-stark-v1'||typeof proof.bytes!=='string'||proof.bytes.length>6*1024*1024)return false;
    const id=sha({proof,signals});if(cache.has(id))return true;
    const valid=await request({op:'verify',publicInput:publicFields(signals),proof});
    if(valid===true){cache.set(id,true);if(cache.size>256)cache.delete(cache.keys().next().value);}return valid===true;
  }catch{return false;}
}
export const proofInfo=()=>request({op:'info'});
export function decodeSignals(s){
  if(!Array.isArray(s)||s.length!==13)throw Error('Invalid public signal count');s.forEach(field);
  const [n0,n1,c0,c1,binding,domain,root,mint,fee,extHash,height,stake,stakeLock]=s;
  uint(mint);uint(fee);uint(height,32);uint(stake);uint(stakeLock,32);
  return {nullifiers:[n0,n1],commitments:[c0,c1],binding,domain,root,mint,fee,extHash,height:Number(height),stake,stakeLock:Number(stakeLock)};
}
