import { createHash,randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';
export const BASE=0xffffffff00000001n,FIELD=1n<<320n,DEPTH=32;
let nativeHash;
export async function initialize(){
  if(nativeHash)return;
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const name=process.platform==='darwin'?'libonlyprivacy_pq.dylib':'libonlyprivacy_pq.so';
  nativeHash=koffi.load(path.join(root,'native',name)).func('int onlyprivacy_hash(const uint64_t *input, size_t length, _Out_ uint64_t *output)');
}
export function digestWords(value){
  field(value);let n=BigInt(value);const out=[];for(let i=0;i<5;i++){out.push(n&((1n<<64n)-1n));n>>=64n;}return out;
}
export const encodeDigest=words=>words.reduce((n,v,i)=>n+(BigInt(v)<<BigInt(64*i)),0n).toString();
export function H(values){
  if(!nativeHash)throw Error('Initialize cryptography first');
  const words=values.flatMap(v=>digestWords(String(v))),input=Buffer.alloc(words.length*8),output=Buffer.alloc(40);
  words.forEach((v,i)=>input.writeBigUInt64LE(v,i*8));
  if(nativeHash(input,words.length,output)!==0)throw Error('Invalid hash input');
  return encodeDigest(Array.from({length:5},(_,i)=>output.readBigUInt64LE(i*8)));
}
export function canonical(value){
  if(typeof value==='bigint')return JSON.stringify(value.toString());
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export const sha=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function fieldHash(value){const bytes=createHash('sha512').update(typeof value==='string'?value:canonical(value)).digest();return encodeDigest(Array.from({length:5},(_,i)=>bytes.readBigUInt64LE(i*8)%BASE));}
export const randomField=()=>encodeDigest(Array.from({length:5},()=>randomBytes(8).readBigUInt64LE()%BASE));
export const ownerOf=(secret,domain)=>H(['101',secret,domain]);
export const commitment=(note,domain)=>H(['102',domain,note.owner,note.value,note.rho,note.lock]);
export const nullifier=(note,domain)=>H(['103',note.secret,note.rho,domain]);
export const bindingOf=(rho,external,root,domain,height)=>H(['104',rho,external,root,domain,String(height)]);
export function field(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,96})$/.test(value)||BigInt(value)>=FIELD)throw Error('Noncanonical digest');
  let n=BigInt(value);for(let i=0;i<5;i++){if((n&((1n<<64n)-1n))>=BASE)throw Error('Invalid digest limb');n>>=64n;}return value;
}
export function uint(value,bits=63){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>=(1n<<BigInt(bits)))throw Error('Invalid unsigned integer');return BigInt(value);
}
export class NoteTree {
  constructor(leaves=[]){
    if(leaves.length>2**DEPTH)throw Error('Tree capacity exceeded');
    this.leaves=[...leaves];this.zeros=['0'];for(let d=0;d<DEPTH;d++)this.zeros.push(H([this.zeros[d],this.zeros[d]]));
    this.levels=[this.leaves];for(let d=0;d<DEPTH;d++){const a=this.levels[d],b=[];for(let i=0;i<a.length;i+=2)b.push(H([a[i],a[i+1]??this.zeros[d]]));this.levels.push(b);}
    this.root=this.levels[DEPTH][0]??this.zeros[DEPTH];
  }
  path(index){
    if(!Number.isInteger(index)||index<0||index>=this.leaves.length)throw Error('Unknown note');const siblings=[],pathBits=[];
    for(let d=0;d<DEPTH;d++){siblings.push(this.levels[d][index^1]??this.zeros[d]);pathBits.push(index&1);index=Math.floor(index/2);}return {siblings,pathBits};
  }
}
