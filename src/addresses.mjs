import {createHash,createPublicKey,timingSafeEqual} from 'node:crypto';
import {digestWords,encodeDigest,field} from './primitives.mjs';
import {SUITES} from './envelopes.mjs';
const PREFIX='onlyprivacy:v1:',CONTEXT=Buffer.from('OnlyPrivacy receive address v1\0');
function validate(invoice){
 if(!invoice||Object.keys(invoice).sort().join(',')!=='domain,owner,protocol,publicKey,suite'||invoice.protocol!=='onlyprivacy-invoice-v1'||!SUITES[invoice.suite])throw Error('Invalid OnlyPrivacy invoice');
 field(invoice.domain);field(invoice.owner);
 if(typeof invoice.publicKey!=='string')throw Error('Missing receiving key');
 const bytes=Buffer.from(invoice.publicKey,'base64');
 if(bytes.length<32||bytes.length>4096||bytes.toString('base64')!==invoice.publicKey)throw Error('Invalid receiving key encoding');
 const key=createPublicKey({key:bytes,type:'spki',format:'der'});
 if(key.asymmetricKeyType!==SUITES[invoice.suite])throw Error('Receiving key uses the wrong encryption suite');
 return bytes;
}
function putDigest(buffer,offset,value){digestWords(value).forEach((v,i)=>buffer.writeBigUInt64LE(v,offset+i*8));}
function getDigest(buffer,offset){const value=encodeDigest(Array.from({length:5},(_,i)=>buffer.readBigUInt64LE(offset+i*8)));field(value);return value;}
const checksum=payload=>createHash('sha3-256').update(CONTEXT).update(payload).digest().subarray(0,8);
export function encodeAddress(invoice){
 const key=validate(invoice),payload=Buffer.alloc(84+key.length);payload[0]=1;payload[1]=invoice.suite;
 putDigest(payload,2,invoice.domain);putDigest(payload,42,invoice.owner);payload.writeUInt16BE(key.length,82);key.copy(payload,84);
 return PREFIX+Buffer.concat([payload,checksum(payload)]).toString('base64url');
}
export function decodeAddress(text,expectedDomain){
 if(typeof text!=='string'||text.length>6000||!text.startsWith(PREFIX)||!/^[A-Za-z0-9_-]+$/.test(text.slice(PREFIX.length)))throw Error('Invalid OnlyPrivacy address');
 const encoded=text.slice(PREFIX.length),bytes=Buffer.from(encoded,'base64url');
 if(bytes.length<124||bytes.toString('base64url')!==encoded)throw Error('Noncanonical address encoding');
 const payload=bytes.subarray(0,-8),check=bytes.subarray(-8);
 if(!timingSafeEqual(checksum(payload),check)||payload[0]!==1||payload.readUInt16BE(82)!==payload.length-84)throw Error('Address checksum or format mismatch');
 const invoice={protocol:'onlyprivacy-invoice-v1',domain:getDigest(payload,2),suite:payload[1],owner:getDigest(payload,42),publicKey:payload.subarray(84).toString('base64')};
 validate(invoice);if(expectedDomain!==undefined&&invoice.domain!==expectedDomain)throw Error('Address belongs to another OnlyPrivacy network');return invoice;
}
