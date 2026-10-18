import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes,createHash } from 'node:crypto';
import { NoteTree,initialize,fieldHash,canonical,sha } from './primitives.mjs';
import { INITIAL,ANNUAL,UNIT,FEE,subsidy,OWNER_ALLOCATION,MINER_RESERVE,RESERVE_YEARS,reserveReward } from './emission.mjs';
import { verify,decodeSignals,PROJECT } from './proofs.mjs';
import { checkEnvelope } from './envelopes.mjs';
import { rewardTransaction } from './transactions.mjs';
import { RandomX,miningKey,difficulty,satisfies } from './pow.mjs';
import { suiteAt,validateGovernance } from './governance.mjs';
import { readJSON,writeJSON } from './storage.mjs';
import {saveBlockDirectory,readBlockIndex,readArchivedBlock,pruneProofs} from './block-storage.mjs';

const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Unexpected protocol fields');
};
const digestFile=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const cloneProposals=map=>new Map([...map].map(([k,v])=>[k,{...v}]));
export class Chain {
  constructor(config) {
    this.config=config;this.blocks=[];this.leaves=[];this.tree=new NoteTree();
    this.roots=new Set([this.tree.root]);this.spent=new Set();this.commitments=new Set();this.proposals=new Map();this.pow=null;
  }
  get height(){return this.blocks.length-1;}
  get supply(){return this.blocks.reduce((s,b)=>s+BigInt(b.header.subsidy),0n);}
  get reserveRemaining(){return MINER_RESERVE-this.blocks.slice(1).reduce((s,b)=>s+BigInt(b.header.reserveRelease),0n);}
  get circulating(){return this.supply-this.reserveRemaining;}
  get work(){return this.blocks.slice(1).reduce((s,b)=>s+BigInt(b.header.difficulty),0n);}
  get emissionHistory(){return this.blocks.map(b=>({timestamp:b.header.timestamp,subsidy:b.header.subsidy,reserveRelease:b.header.reserveRelease,id:b.id,difficulty:b.header.difficulty}));}
  activeSuite(height=this.blocks.length){return suiteAt(this.proposals,this.config,height);}
  engine(){return this.pow??=new RandomX();}
  close(){this.pow?.close();this.pow=null;}
  static async create(wallet,{timestamp=Math.floor(Date.now()/1000),quorumVotes=1000,votingBlocks=1440,activationDelay=360}={}) {
    await initialize();
    if(!validGovernance({quorumVotes,votingBlocks,activationDelay}))throw Error('Invalid or unreachable governance quorum');
    const config={protocol:'ONLYPRIVACY-STARK-1',domain:fieldHash(randomBytes(32).toString('hex')),initial:INITIAL.toString(),annual:ANNUAL.toString(),
      ownerAllocation:OWNER_ALLOCATION.toString(),minerReserve:MINER_RESERVE.toString(),reserveYears:RESERVE_YEARS,
      treeDepth:32,targetSeconds:120,proofProgramHash:await digestFile(path.join(PROJECT,'pq/transfer.tasm')),
      governance:{quorumVotes,votingBlocks,activationDelay},purpose:'OnlyPrivacy experimental post-quantum STARK network; independent audit absent'};
    const chain=new Chain(config);
    const tx=await rewardTransaction(chain,wallet,OWNER_ALLOCATION,0);
    const header={version:1,domain:config.domain,configuration:sha(config),height:0,previous:'0'.repeat(64),timestamp,difficulty:'0',subsidy:INITIAL.toString(),reserveRelease:'0',transactionsDigest:sha([tx]),nonce:'0'};
    const block={header,transactions:[tx],pow:null,id:sha({header,pow:null})};
    await chain.append(block);return chain;
  }
  static async load(file) {
    const index=await readBlockIndex(file);if(index.legacy)return Chain.fromData(index.legacy);
    const first=await readArchivedBlock(index.directory,index.ids[0]);
    const chain=await Chain.fromData({config:index.config,blocks:[first]});chain.archivePaths=new Map();
    try{
      for(let i=0;i<index.ids.length;i++){
        const id=index.ids[i],file=path.join(index.directory,id+'.json');
        if(i>0){const block=await readArchivedBlock(index.directory,id);if(block.id!==id)throw Error('Archived block id mismatch');await chain.append(block);}
        else if(first.id!==id)throw Error('Archived genesis mismatch');
        chain.archivePaths.set(id,file);pruneProofs(chain.blocks.at(-1),file);
      }
      return chain;
    }catch(error){chain.close();throw error;}
  }
  static async fromData(data,checkpoint=null) {
    await initialize();exact(data,['config','blocks']);
    const c=data.config;exact(c,['protocol','domain','initial','annual','treeDepth','targetSeconds','proofProgramHash','ownerAllocation','minerReserve','reserveYears','governance','purpose']);
    if(c.protocol!=='ONLYPRIVACY-STARK-1'||c.initial!==INITIAL.toString()||c.annual!==ANNUAL.toString()||c.treeDepth!==32||c.targetSeconds!==120)throw Error('Incompatible monetary constitution');
    exact(c.governance,['quorumVotes','votingBlocks','activationDelay']);
    if(!validGovernance(c.governance))throw Error('Invalid governance constitution');
    if(c.proofProgramHash!==await digestFile(path.join(PROJECT,'pq/transfer.tasm'))||c.ownerAllocation!==OWNER_ALLOCATION.toString()||c.minerReserve!==MINER_RESERVE.toString()||c.reserveYears!==RESERVE_YEARS)throw Error('Pinned verifier key mismatch');
    if(!Array.isArray(data.blocks)||!data.blocks.length||data.blocks.length>4000000)throw Error('Invalid chain length');
    if(checkpoint&&(canonical(c)!==canonical(checkpoint.config)||data.blocks[0].id!==checkpoint.blocks[0].id))throw Error('Different network/genesis checkpoint');
    const chain=new Chain(c);
    try {for(const block of data.blocks)await chain.append(block);return chain;}
    catch(e){chain.close();throw e;}
  }
  data(){return {config:this.config,blocks:this.blocks};}
  async save(file){await saveBlockDirectory(this,file);}
  transactionState() {
    return {spent:new Set(this.spent),commitments:new Set(this.commitments),roots:new Set(this.roots),proposals:cloneProposals(this.proposals)};
  }
  fork() {
    const copy=new Chain(structuredClone(this.config));
    Object.assign(copy,this.transactionState(),{blocks:[...this.blocks],leaves:[...this.leaves],tree:this.tree,archivePaths:new Map(this.archivePaths??[])});
    return copy;
  }
  replace(candidate) {this.close();Object.assign(this,candidate);}
  async adopt(data) {
    const candidate=await Chain.fromData(data,this);
    if(candidate.work<=this.work){candidate.close();return false;}
    this.replace(candidate);return true;
  }
  // Callers pass disposable state. A rejected transaction never changes the chain.
  async validateTransaction(tx,{height=this.blocks.length,mint=null,state=this.transactionState()}={}) {
    exact(tx,['external','proof','publicSignals']);
    if(Buffer.byteLength(canonical(tx))>6*1024*1024)throw Error('Transaction size limit');
    const s=decodeSignals(tx.publicSignals),e=tx.external;
    exact(e,['version','domain','suite','height','nonce','action','envelopes']);
    const activeSuite=this.activeSuite(height);
    if(e.version!==1||e.domain!==this.config.domain||s.domain!==this.config.domain||e.suite!==activeSuite||e.height!==s.height)throw Error('Transaction domain/suite mismatch');
    if(!Number.isSafeInteger(e.height)||e.height>height||height-e.height>64||typeof e.nonce!=='string'||!/^[a-f0-9]{64}$/.test(e.nonce))throw Error('Expired/invalid transaction context');
    if(s.extHash!==fieldHash(e)||!state.roots.has(s.root))throw Error('Modified envelope or unknown anchor');
    if(!Array.isArray(e.envelopes)||e.envelopes.length!==2)throw Error('Envelope count');
    e.envelopes.forEach(box=>checkEnvelope(box,activeSuite));
    if(mint!==null) {
      if(canonical(e.action)!==canonical({type:'mint'})||s.height!==height||s.mint!==mint.toString()||s.fee!=='0'||s.stake!=='0'||s.stakeLock!==0||s.nullifiers.some(n=>n!=='0'))throw Error('Invalid private coinbase');
    }else {
      if(s.mint!=='0'||s.fee!==FEE.toString()||s.nullifiers.every(n=>n==='0'))throw Error('Invalid payment issuance/fee');
      if(e.action.type!=='payment'&&s.height!==height)throw Error('Governance target block changed; recreate transaction');
      validateGovernance(e.action,s,state.proposals,this.config,height);
    }
    for(const nf of s.nullifiers) {
      if(nf==='0')continue;if(state.spent.has(nf))throw Error('Double spend / duplicate nullifier');state.spent.add(nf);
    }
    for(const cm of s.commitments){if(state.commitments.has(cm)||cm==='0')throw Error('Duplicate/invalid commitment');state.commitments.add(cm);}
    if(!await verify(tx.proof,tx.publicSignals))throw Error('Rejected zero-knowledge proof');
    return s;
  }
  async append(block) {
    exact(block,['header','transactions','pow','id']);
    const h=block.header;exact(h,['version','domain','configuration','height','previous','timestamp','difficulty','subsidy','reserveRelease','transactionsDigest','nonce']);
    if(h.configuration!==sha(this.config))throw Error('Genesis/consensus configuration mismatch');
    if(h.version!==1||h.domain!==this.config.domain||h.height!==this.blocks.length)throw Error('Invalid block identity/height');
    if(!Number.isSafeInteger(h.timestamp)||h.timestamp<0||h.timestamp>Math.floor(Date.now()/1000)+120)throw Error('Invalid/future timestamp');
    if(typeof h.nonce!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(h.nonce)||BigInt(h.nonce)>=(1n<<64n))throw Error('Invalid nonce');
    if(!Array.isArray(block.transactions)||!block.transactions.length||block.transactions.length>4)throw Error('Block transaction limit');
    if(Buffer.byteLength(canonical(block))>24*1024*1024)throw Error('Block size limit');
    if(h.transactionsDigest!==sha(block.transactions)||block.id!==sha({header:h,pow:block.pow}))throw Error('Modified block');
    const history=this.emissionHistory;
    let allowed,reserve=0n;
    if(h.height===0) {
      if(h.previous!=='0'.repeat(64)||h.difficulty!=='0'||h.subsidy!==INITIAL.toString()||block.pow!==null||block.transactions.length!==1||h.reserveRelease!=='0')throw Error('Invalid genesis');allowed=OWNER_ALLOCATION;
    } else {
      const tip=this.blocks.at(-1);
      if(h.previous!==tip.id||h.timestamp<=tip.header.timestamp)throw Error('Nonmonotonic block or wrong parent');
      const expected=difficulty(history);
      if(h.difficulty!==expected.toString()||typeof block.pow!=='string'||!/^[a-f0-9]{64}$/.test(block.pow))throw Error('Invalid difficulty/work');
      if(!satisfies(block.pow,expected)||this.engine().hash(h,miningKey(history,this.config.domain))!==block.pow)throw Error('Invalid RandomX proof of work');
      allowed=subsidy(history,h.timestamp);reserve=reserveReward(history,h.timestamp);if(h.reserveRelease!==reserve.toString())throw Error('Invalid mining reserve release');if(h.subsidy!==allowed.toString())throw Error('Excess or incorrect issuance');
    }
    const leaves=[...this.leaves],state=this.transactionState();
    const fees=block.transactions.slice(1).reduce((s,t)=>s+BigInt(decodeSignals(t.publicSignals).fee),0n);
    for(let index=0;index<block.transactions.length;index++) {
      const s=await this.validateTransaction(block.transactions[index],{height:h.height,mint:index===0?allowed+reserve+fees:null,state});
      leaves.push(...s.commitments);state.roots.add(new NoteTree(leaves).root);
      if(state.roots.size>256)state.roots.delete(state.roots.values().next().value);
    }
    this.leaves=leaves;this.tree=new NoteTree(leaves);Object.assign(this,state);
    this.blocks.push(structuredClone(block));return block.id;
  }
  async mine(wallet,transactions=[],{timestamp=Math.max(Math.floor(Date.now()/1000),this.blocks.at(-1).header.timestamp+1),maxAttempts=1000}={}) {
    if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>100000)throw Error('Explicit bounded mining attempts required');
    const history=this.emissionHistory,height=this.blocks.length;
    const amount=subsidy(history,timestamp),reserve=reserveReward(history,timestamp),fees=transactions.reduce((s,t)=>s+BigInt(decodeSignals(t.publicSignals).fee),0n);
    const reward=await rewardTransaction(this,wallet,amount+reserve+fees,height),txs=[reward,...transactions];
    const header={version:1,domain:this.config.domain,configuration:sha(this.config),height,previous:this.blocks.at(-1).id,timestamp,difficulty:difficulty(history).toString(),subsidy:amount.toString(),reserveRelease:reserve.toString(),transactionsDigest:sha(txs),nonce:'0'};
    let work;
    for(let n=0;n<maxAttempts;n++) {
      header.nonce=String(n);work=this.engine().hash(header,miningKey(history,this.config.domain));
      if(satisfies(work,header.difficulty)) {
        const block={header,transactions:txs,pow:work,id:sha({header,pow:work})};await this.append(block);wallet.scan(this);return block;
      }
    }
    throw Error('Mining attempt limit reached; no block published');
  }
}
function validGovernance(g) {
  return Number.isInteger(g.quorumVotes)&&g.quorumVotes>=1&&g.quorumVotes<=10000&&
    Number.isInteger(g.votingBlocks)&&g.votingBlocks>=6&&g.votingBlocks<=525600&&
    Number.isInteger(g.activationDelay)&&g.activationDelay>=2&&g.activationDelay<=525600&&
    g.quorumVotes<=3*(g.votingBlocks-1);
}
