import { encryptWallet,decryptWallet,invoiceKeyPair,openNote,invoiceId,SUITES } from './envelopes.mjs';
import { randomField,ownerOf,commitment,nullifier,uint,field,sha } from './primitives.mjs';
import { readJSON,writeJSON } from './storage.mjs';
export class Wallet {
  constructor(data={version:1,invoices:[],notes:[],usedRecipients:[]}) {this.data=data;this.data.pending??=[];}
  static async load(file,password) {return new Wallet(decryptWallet(await readJSON(file),password));}
  static async create(file,password) {
    const wallet=new Wallet();
    await writeJSON(file,encryptWallet(wallet.data,password),0o600,{replace:false});return wallet;
  }
  async save(file,password) {await writeJSON(file,encryptWallet(this.data,password));}
  invoice(domain,suite=2) {
    if(!SUITES[suite])throw Error('Unsupported suite');
    const secret=randomField(),{publicKey,privateKey}=invoiceKeyPair(suite);
    const invoice={protocol:'onlyprivacy-invoice-v1',domain,suite,owner:ownerOf(secret,domain),publicKey};
    this.data.invoices.push({invoice,secret,privateKey});return invoice;
  }
  scan(chain) {
    this.domain=chain.config.domain;
    this.data.pending=this.data.pending.filter(p=>p.domain!==chain.config.domain||
      (chain.blocks.length<=p.lastValidHeight&&!p.nullifiers.some(n=>chain.spent.has(n))));
    const reserved=new Set(this.data.pending.filter(p=>p.domain===chain.config.domain).flatMap(p=>p.nullifiers));
    const notes=[];let position=0;
    for(const block of chain.blocks) for(const tx of block.transactions) {
      const cm=tx.publicSignals.slice(2,4);
      for(let i=0;i<2;i++,position++) {
        for(const entry of this.data.invoices) {
          if(entry.invoice.domain!==chain.config.domain)continue;
          const n=openNote(tx.external.envelopes[i],entry.privateKey,chain.config.domain,cm[i]);
          if(!n)continue;
          try{
            field(n.owner);field(n.rho);uint(n.value);uint(n.lock,32);
            if(n.owner!==entry.invoice.owner||commitment(n,chain.config.domain)!==cm[i])continue;
            if(BigInt(n.value)>0n) {
              const note={...n,secret:entry.secret,position,commitment:cm[i]};
              const nf=nullifier(note,chain.config.domain);
              note.spent=chain.spent.has(nf);note.reserved=reserved.has(nf);notes.push(note);
            }
          }catch{/* Treat malformed plaintext as an unusable output. */}
          break;
        }
      }
    }
    this.data.notes=notes;return this.balance(chain.blocks.length);
  }
  balance(height) {
    return this.data.notes.filter(n=>!n.spent).reduce((s,n)=>{
      s.total+=BigInt(n.value);if(n.reserved)s.reserved+=BigInt(n.value);else if(Number(n.lock)<=height)s.available+=BigInt(n.value);else s.locked+=BigInt(n.value);return s;
    },{total:0n,available:0n,locked:0n,reserved:0n});
  }
  select(amount,height) {
    const notes=this.data.notes.filter(n=>!n.spent&&!n.reserved&&Number(n.lock)<=height).sort((a,b)=>BigInt(a.value)>BigInt(b.value)?-1:1);
    const selected=[];let sum=0n;
    for(const n of notes.slice(0,2)){selected.push(n);sum+=BigInt(n.value);if(sum>=amount)return selected;}
    throw Error('Insufficient unlocked balance in two notes; consolidate notes first');
  }
  consumeInvoice(invoice) {
    const id=invoiceId(invoice);if(this.data.usedRecipients.includes(id))throw Error('Invoice already used: request a fresh one-time invoice');
    this.data.usedRecipients.push(id);
  }
  reserve(transaction,chain) {
    const id=sha(transaction);
    if(!this.data.pending.some(p=>p.id===id))this.data.pending.push({id,domain:chain.config.domain,
      nullifiers:transaction.publicSignals.slice(0,2).filter(n=>n!=='0'),lastValidHeight:transaction.external.height+64});
    this.scan(chain);return id;
  }
}
