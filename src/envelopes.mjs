import { generateKeyPairSync, createPublicKey, createPrivateKey, encapsulate, decapsulate, hkdfSync, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { canonical, sha } from './primitives.mjs';
export const SUITES=Object.freeze({1:'ml-kem-768',2:'ml-kem-1024'});
const PAYLOAD_SIZE=1024;
export function invoiceKeyPair(suite=2) {
  const algorithm=SUITES[suite];if(!algorithm)throw Error('Unsupported encryption suite');
  const pair=generateKeyPairSync(algorithm);
  return {publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),privateKey:pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64')};
}
function derive(shared,domain) {return Buffer.from(hkdfSync('sha256',shared,Buffer.from(domain),Buffer.from('OnlyPrivacy note envelope v1'),32));}
function aesEncrypt(plain,key,aad) {
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
  const data=Buffer.concat([cipher.update(plain),cipher.final()]);return {nonce:nonce.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function aesDecrypt(box,key,aad) {
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(box.nonce,'base64'));d.setAAD(aad);d.setAuthTag(Buffer.from(box.tag,'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data,'base64')),d.final()]);
}
export function sealNote(note,invoice,domain,commitment) {
  const publicKey=createPublicKey({key:Buffer.from(invoice.publicKey,'base64'),type:'spki',format:'der'});
  if(publicKey.asymmetricKeyType!==SUITES[invoice.suite])throw Error('Invoice key/suite mismatch');
  const {sharedKey,ciphertext}=encapsulate(publicKey),raw=Buffer.from(canonical(note));
  if(raw.length>PAYLOAD_SIZE-2){sharedKey.fill(0);raw.fill(0);throw Error('Note memo is too long');}
  const plain=randomBytes(PAYLOAD_SIZE);plain.writeUInt16BE(raw.length);raw.copy(plain,2);
  const key=derive(sharedKey,domain);
  try{return {suite:invoice.suite,kem:ciphertext.toString('base64'),...aesEncrypt(plain,key,Buffer.from(domain+':'+commitment))};}
  finally{sharedKey.fill(0);key.fill(0);plain.fill(0);raw.fill(0);}
}
export function openNote(box,privateKey,domain,commitment) {
  let shared,key,plain;
  try {
    const pk=createPrivateKey({key:Buffer.from(privateKey,'base64'),type:'pkcs8',format:'der'});
    if(pk.asymmetricKeyType!==SUITES[box.suite])return null;
    shared=decapsulate(pk,Buffer.from(box.kem,'base64'));key=derive(shared,domain);
    plain=aesDecrypt(box,key,Buffer.from(domain+':'+commitment));
    if(plain.length!==PAYLOAD_SIZE)return null;
    const n=plain.readUInt16BE();if(n>PAYLOAD_SIZE-2)return null;
    return JSON.parse(plain.subarray(2,2+n));
  } catch {return null;}finally{shared?.fill(0);key?.fill(0);plain?.fill(0);}
}
export function checkEnvelope(e,suite) {
  if(!e||e.suite!==suite||Object.keys(e).sort().join(',')!=='data,kem,nonce,suite,tag')throw Error('Invalid envelope');
  const expected=SUITES[suite]==='ml-kem-768'?1088:1568;
  for(const [key,length] of [['kem',expected],['data',PAYLOAD_SIZE],['nonce',12],['tag',16]]) {
    if(typeof e[key]!=='string'||Buffer.from(e[key],'base64').length!==length||Buffer.from(e[key],'base64').toString('base64')!==e[key])throw Error('Invalid ciphertext length/encoding');
  }
}
export function encryptWallet(data,password) {
  if(typeof password!=='string'||password.length<12)throw Error('Wallet password must have at least 12 characters');
  const salt=randomBytes(32),key=scryptSync(password,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024});
  const plain=Buffer.from(canonical(data));
  try{return {version:1,kdf:'scrypt-N131072-r8-p1',salt:salt.toString('base64'),...aesEncrypt(plain,key,Buffer.from('OnlyPrivacy encrypted wallet v1'))};}
  finally{key.fill(0);plain.fill(0);}
}
export function decryptWallet(box,password) {
  if(box.version!==1||box.kdf!=='scrypt-N131072-r8-p1'||Buffer.from(box.salt,'base64').length!==32)throw Error('Unknown wallet format');
  const key=scryptSync(password,Buffer.from(box.salt,'base64'),32,{N:131072,r:8,p:1,maxmem:256*1024*1024});
  let plain;
  try{plain=aesDecrypt(box,key,Buffer.from('OnlyPrivacy encrypted wallet v1'));return JSON.parse(plain);}catch{throw Error('Incorrect password or altered wallet');}finally{key.fill(0);plain?.fill(0);}
}
export const invoiceId=invoice=>sha(invoice);
