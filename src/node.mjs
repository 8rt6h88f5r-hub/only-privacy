import fs from 'node:fs/promises';
import { Chain } from './chain.mjs';
import { canonical,sha } from './primitives.mjs';
import { readJSON,writeJSON } from './storage.mjs';

export const POOL_LIMIT=32;
export const transactionPacket=(chain,transaction)=>({protocol:'onlyprivacy-transaction-v1',genesis:chain.blocks[0].id,transaction});

function unpack(packet,chain) {
  if(!packet||Object.keys(packet).sort().join(',')!=='genesis,protocol,transaction'||packet.protocol!=='onlyprivacy-transaction-v1'||packet.genesis!==chain.blocks[0].id)throw Error('Transaction belongs to another network');
  if(Buffer.byteLength(canonical(packet))>6*1024*1024+1024)throw Error('Transaction packet too large');
  return structuredClone(packet.transaction);
}

// The public node never receives a wallet, password, ownership secret or recipient key.
export class PublicNode {
  constructor(chain,{chainFile,poolFile=chainFile+'.pending.json',persist=writeJSON}={}) {
    if(!chainFile)throw Error('A durable chain file is required');
    this.chain=chain;this.chainFile=chainFile;this.poolFile=poolFile;this.persist=persist;
    this.pool=new Map();this.queue=Promise.resolve();this.queued=0;this.poolDurable=true;this.halted=false;
  }
  static async open(chainFile,options={}) {
    const chain=await Chain.load(chainFile),node=new PublicNode(chain,{...options,chainFile});
    try {
      if(await fs.access(node.poolFile).then(()=>true,()=>false)) {
        const saved=await readJSON(node.poolFile,256*1024*1024);
        if(saved.version!==1||saved.genesis!==chain.blocks[0].id||!Array.isArray(saved.transactions)||saved.transactions.length>POOL_LIMIT)throw Error('Invalid saved pending transactions');
        await node.reconcile(saved.transactions);
      }
      return node;
    }catch(error){chain.close();throw error;}
  }
  serial(fn) {
    if(this.queued>=8)return Promise.reject(Error('Node busy; retry later'));
    this.queued++;
    const task=this.queue.then(()=>{if(this.halted)throw Error('Storage durability uncertain; restart and revalidate the node');return fn();});this.queue=task.catch(()=>{});
    return task.finally(()=>this.queued--);
  }
  packets(limit=POOL_LIMIT){return [...this.pool.values()].slice(0,limit).map(tx=>transactionPacket(this.chain,structuredClone(tx)));}
  async savePool(pool=this.pool) {
    await this.persist(this.poolFile,{version:1,genesis:this.chain.blocks[0].id,transactions:[...pool.values()]});
  }
  async reconcile(transactions=[...this.pool.values()]) {
    const next=new Map(),state=this.chain.transactionState();
    for(const tx of transactions) {
      const trial={spent:new Set(state.spent),commitments:new Set(state.commitments),roots:state.roots,
        proposals:new Map([...state.proposals].map(([id,p])=>[id,{...p}]))};
      try{await this.chain.validateTransaction(tx,{state:trial});next.set(sha(tx),tx);Object.assign(state,trial);}catch{/* Mined, expired or conflicting transactions leave the pool. */}
    }
    this.pool=next;
    try{await this.savePool();this.poolDurable=true;}catch{this.poolDurable=false;}
  }
  acceptTransaction(packet) {
    return this.serial(async()=>{
      const tx=unpack(packet,this.chain),id=sha(tx);
      if(this.pool.has(id))return {id,accepted:false,known:true};
      if(this.pool.size>=POOL_LIMIT)throw Error('Pending transaction pool full');
      const state=this.chain.transactionState();
      for(const prior of this.pool.values())await this.chain.validateTransaction(prior,{state});
      await this.chain.validateTransaction(tx,{state});
      const next=new Map(this.pool);next.set(id,tx);
      await this.savePool(next);this.pool=next;this.poolDurable=true;
      return {id,accepted:true,known:false};
    });
  }
  async commit(candidate) {
    try{if(this.persist===writeJSON)await candidate.save(this.chainFile);else await this.persist(this.chainFile,candidate.data());}
    catch(error) {
      if(error.replacementVisible) {
        // Rename succeeded but directory fsync failed: do not pretend rollback.
        this.chain.replace(candidate);this.chain.close();this.halted=true;await this.reconcile();
      }
      throw error;
    }
    this.chain.replace(candidate);
    // The chain is authoritative. A stale pool file is revalidated on restart.
    await this.reconcile();
  }
  acceptBlock(block) {
    return this.serial(async()=>{
      if(this.chain.blocks.some(b=>b.id===block?.id))return {id:block.id,accepted:false,known:true};
      const candidate=this.chain.fork();let committed=false;
      try {
        await candidate.append(structuredClone(block));await this.commit(candidate);committed=true;
        return {id:block.id,accepted:true,known:false};
      }finally{if(!committed)candidate.close();}
    });
  }
  importVerifiedCandidate(candidate) {
    return this.serial(async()=>{
      if(candidate.blocks[0]?.id!==this.chain.blocks[0].id||canonical(candidate.config)!==canonical(this.chain.config))throw Error('Different network');
      if(candidate.work<=this.chain.work){candidate.close();return false;}
      await this.commit(candidate);return true;
    });
  }
  importChain(data) {
    return this.serial(async()=>{
      const candidate=await Chain.fromData(data,this.chain);let committed=false;
      try {
        if(candidate.work<=this.chain.work)return false;
        await this.commit(candidate);committed=true;return true;
      }finally{if(!committed)candidate.close();}
    });
  }
  close(){this.chain.close();}
}
