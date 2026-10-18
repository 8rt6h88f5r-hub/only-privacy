import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { initialize } from './primitives.mjs';
import { Wallet } from './wallet.mjs';
import { Chain } from './chain.mjs';
import { buildTransaction } from './transactions.mjs';
import { UNIT,FEE,formatAmount,parseAmount } from './emission.mjs';
import { proposalAction } from './governance.mjs';
import { readJSON,writeJSON,exclusive,exclusiveMany } from './storage.mjs';
import { checkArtifacts,checkPrivateFile } from './security.mjs';
import { fetchPeerChain,fetchPending,serveNode,submitTransaction,submitBlock } from './transport.mjs';
import { PublicNode,transactionPacket,POOL_LIMIT } from './node.mjs';
import { followPeers,validatePeers } from './peers.mjs';
import { PROJECT } from './proofs.mjs';
import { readOwnerSecret } from './keychain.mjs';
import { downloadCandidate } from './synchronization.mjs';
import { encodeAddress,decodeAddress } from './addresses.mjs';
process.chdir(PROJECT);
const output=x=>console.log(JSON.stringify(x,(_,v)=>typeof v==='bigint'?formatAmount(v):v,2));
async function password() {
  if(process.env.ONLYPRIVACY_OWNER_METADATA){const metadata=await readJSON(process.env.ONLYPRIVACY_OWNER_METADATA);return readOwnerSecret(metadata.keychainService);}
  const supplied=process.env.ONLYPRIVACY_WALLET_PASSWORD??process.env.ONLYP_WALLET_PASSWORD??process.env.IPC_WALLET_PASSWORD;
  if(supplied)return supplied;
  if(!process.stdin.isTTY)throw Error('Use an interactive terminal for the wallet password (never put a password in arguments)');
  process.stderr.write('지갑 비밀번호: ');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';const done=()=>{process.stdin.off('data',receive);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');};
    const receive=text=>{for(const c of text){if(c==='\r'||c==='\n'){done();resolve(value);return;}if(c==='\u0003'){done();reject(Error('Cancelled'));return;}if(c==='\u007f')value=value.slice(0,-1);else value+=c;}};
    process.stdin.on('data',receive);
  });
}
const defaults={chain:'data/chain.json',wallet:'data/wallet.enc.json'};
const proxyOptions={proxyPort:Number(process.env.ONLYPRIVACY_TOR_PROXY_PORT??process.env.IPC_TOR_PROXY_PORT??19050)};
let chain;
async function main(args) {
  const [cmd,...a]=args;
  await initialize();
  if(cmd==='help'||!cmd){console.log('온리프라이버시 (연구용)\njoin [지갑파일] [체인파일]\ninit [지갑파일] [체인파일] (별도 연구 네트워크)\nnew-wallet [지갑파일]\nbalance [지갑파일] [체인파일]\ninvoice [지갑파일] [체인파일] [주소출력파일]\nsend <일회용주소파일> <금액> [지갑파일] [체인파일]\nprepare <일회용주소파일> <금액> [지갑파일] [체인파일] [거래출력파일]\nsubmit <거래파일> <http://...onion/>\nmine [지갑파일] [체인파일]\nmine-remote <http://...onion/> [지갑파일] [로컬체인파일]\nsubmit-block <블록파일> <http://...onion/>\npending [지갑파일] [체인파일]\nrenew [지갑파일] [체인파일] [갱신거래파일]\npropose-upgrade [지갑파일] [체인파일]\nvote <제안ID> <yes|no> [지갑파일] [체인파일]\ngovernance [체인파일]\nverify [체인파일]\nsync <http://...onion:포트/> [체인파일]\nserve [체인파일] [포트]\nrun <피어설정파일> [체인파일] [포트]\ndoctor\nmenu');return;}
  if(cmd==='menu') {
    const r=createInterface({input:process.stdin,output:process.stdout});
    console.log('\n온리프라이버시 — 연구 네트워크\n1. 공개 온리프라이버시에 참여할 내 지갑 만들기\n2. 내 잔액\n3. 새 일회용 수신 주소 발급\n4. CPU로 블록 1개 채굴\n5. 보안 점검\n6. 명령 사용법\n7. 별도의 수신 지갑 만들기\n8. 비공개 송금과 로컬 채굴\n9. 다른 채굴자에게 보낼 비공개 거래 만들기\n10. 만든 거래를 Tor로 제출\n11. Tor 노드에서 받은 거래 채굴');
    const n=await r.question('선택: ');let command;
    if(n==='7')command=['new-wallet',(await r.question('새 지갑 파일명 [data/receive-wallet.enc.json]: '))||'data/receive-wallet.enc.json'];
    else if(n==='8')command=['send',await r.question('받는 사람의 일회용 주소 파일: '),await r.question('보낼 ONLYP 수량: ')];
    else if(n==='9')command=['prepare',await r.question('받는 사람의 일회용 주소 파일: '),await r.question('보낼 ONLYP 수량: ')];
    else if(n==='10')command=['submit',(await r.question('거래 파일 [data/transaction.json]: '))||'data/transaction.json',await r.question('노드의 onion URL: ')];
    else if(n==='11'||n==='4'){let seed='';try{seed=(await readJSON('config/peers.json',8192))[0]??'';}catch{}command=['mine-remote',(await r.question('노드의 onion URL ['+seed+']: '))||seed];}
    else command=[{'1':'join','2':'balance','3':'invoice','4':'mine','5':'doctor','6':'help'}[n]??'help'];
    r.close();return main(command);
  }
  if(cmd==='doctor'){output(await checkArtifacts());return;}
  if(cmd==='join') {
    const wf=a[0]??defaults.wallet,cf=a[1]??defaults.chain,pass=await password();
    return exclusiveMany([wf,cf],async()=>{
      if(await fs.access(cf).then(()=>true,()=>false))throw Error('Local chain already exists');
      if(!(await checkArtifacts()).ok)throw Error('Cryptographic artifacts changed');
      chain=await Chain.load('network/genesis.json');await Wallet.create(wf,pass);await chain.save(cf);
      output({coin:'OnlyPrivacy',joined:true,genesis:chain.blocks[0].id,wallet:wf,chain:cf,balance:'0',notice:'새 발행 없이 공개 네트워크의 채굴 참여 지갑을 만들었습니다.'});
    });
  }
  if(cmd==='new-wallet') {
    const wf=a[0]??defaults.wallet;await fs.mkdir(path.dirname(path.resolve(wf)),{recursive:true,mode:0o700});
    const pass=await password();await exclusive(wf,()=>Wallet.create(wf,pass));output({wallet:wf,status:'기존 체인에서 사용할 별도 암호화 지갑 생성. 새 코인을 발행하지 않았습니다.'});return;
  }
  if(cmd==='init') {
    const wf=a[0]??defaults.wallet,cf=a[1]??defaults.chain;
    await fs.mkdir(path.dirname(path.resolve(wf)),{recursive:true,mode:0o700});
    const pass=await password();
    return exclusiveMany([wf,cf],async()=>{
      if(await fs.access(cf).then(()=>true,()=>false))throw Error('Chain file already exists');
      if(!(await checkArtifacts()).ok)throw Error('Cryptographic artifacts changed');
      const wallet=await Wallet.create(wf,pass);
      chain=await Chain.create(wallet);await wallet.save(wf,pass);await chain.save(cf);
      output({status:'로컬 연구 체인 생성',initialSupply:'10000',wallet:wf,chain:cf,genesis:chain.blocks[0].id,domain:chain.config.domain});
    });
  }
  if(cmd==='submit'||cmd==='submit-block') {
    const data=await readJSON(a[0],cmd==='submit'?6*1024*1024+1024:24*1024*1024);
    output(await (cmd==='submit'?submitTransaction(a[1],data,proxyOptions):submitBlock(a[1],data,proxyOptions)));return;
  }
  if(['serve','run'].includes(cmd)) {
    const cf=(cmd==='run'?a[1]:a[0])??defaults.chain,port=Number((cmd==='run'?a[2]:a[1])??18773);
    const peers=cmd==='run'?validatePeers(await readJSON(a[0],8192)):[];
    return exclusiveMany([cf,cf+'.pending.json'],async()=>{
      if(!(await checkArtifacts()).ok)throw Error('Cryptographic artifacts changed');
      const node=await PublicNode.open(cf);chain=node.chain;
      const server=serveNode(node,{port});
      await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      const follower=followPeers(node,peers,proxyOptions);
      console.log('공개 노드: 127.0.0.1:'+server.address().port+' · 지정한 Tor 피어 '+peers.length+'개 · 지갑 비밀키가 필요하지 않습니다. 종료: Ctrl+C');
      await new Promise(resolve=>{const stop=()=>resolve();process.once('SIGINT',stop);process.once('SIGTERM',stop);});
      await follower.stop();await new Promise(resolve=>server.close(resolve));await node.queue;node.close();
    });
  }
  if(['verify','governance','sync'].includes(cmd)) {
    const cf=(cmd==='sync'?a[1]:a[0])??defaults.chain;
    if(cmd==='sync')return exclusive(cf,async()=>{chain=await Chain.load(cf);const candidate=await downloadCandidate(a[0],chain,{...proxyOptions,candidateFile:cf+'.sync-candidate.json'});if(!candidate){output({adopted:false,height:chain.height});return;}try{if(candidate.work>chain.work){await candidate.save(cf);chain.replace(candidate);output({adopted:true,height:chain.height});}else{candidate.close();output({adopted:false,height:chain.height});}}catch(e){candidate.close();throw e;}});
    chain=await Chain.load(cf);
    if(cmd==='verify')output({valid:true,height:chain.height,supply:chain.supply,circulating:chain.circulating,reserveRemaining:chain.reserveRemaining,work:chain.work.toString(),genesis:chain.blocks[0].id,suite:chain.activeSuite()});
    else if(cmd==='governance')output({suite:chain.activeSuite(),quorumVotes:chain.config.governance.quorumVotes,proposals:[...chain.proposals.values()]});
    return;
  }
  let wf,cf;
  if(['send','prepare','vote'].includes(cmd)){wf=a[2]??defaults.wallet;cf=a[3]??defaults.chain;}
  else if(cmd==='mine-remote'){wf=a[1]??defaults.wallet;cf=a[2]??defaults.chain;}
  else {wf=a[0]??defaults.wallet;cf=a[1]??defaults.chain;}
  const pass=await password();
  if(!await checkPrivateFile(wf))throw Error('Wallet permissions must be private (0600)');
  if(!(await checkArtifacts()).ok)throw Error('Cryptographic artifacts changed');
  const readOnlyChain=['balance','invoice','pending','prepare','renew'].includes(cmd);
  return exclusiveMany(readOnlyChain?[wf]:[wf,cf,cf+'.pending.json'],async()=>{
    chain=await Chain.load(cf);const wallet=await Wallet.load(wf,pass);wallet.scan(chain);
    if(cmd==='balance'){output(wallet.balance(chain.blocks.length));return;}
    if(cmd==='pending'){await wallet.save(wf,pass);output({pending:wallet.data.pending,balance:wallet.balance(chain.blocks.length)});return;}
    if(cmd==='invoice') {
      const invoice=wallet.invoice(chain.config.domain,chain.activeSuite());await wallet.save(wf,pass);
      const dest=a[2]??'data/receive-once.json';await writeJSON(dest,invoice);output({invoice:dest,address:encodeAddress(invoice),notice:'매번 새 주소를 사용합니다. 주소와 QR에는 공개 수신 정보만 들어갑니다.'});return;
    }
    if(cmd==='mine') {
      const block=await chain.mine(wallet,[],{maxAttempts:1000});await wallet.save(wf,pass);await chain.save(cf);
      output({height:chain.height,block:block.id,subsidy:formatAmount(block.header.subsidy),balance:wallet.scan(chain)});return;
    }
    if(cmd==='mine-remote') {
      const node=new PublicNode(chain,{chainFile:cf});
      const candidate=await downloadCandidate(a[0],chain,{...proxyOptions,candidateFile:cf+'.sync-candidate.json'});if(candidate)await node.importVerifiedCandidate(candidate);
      const pending=await fetchPending(a[0],proxyOptions);
      if(!Array.isArray(pending.packets)||pending.packets.length>POOL_LIMIT)throw Error('Invalid peer pending list');
      for(const packet of pending.packets){try{await node.acceptTransaction(packet);}catch{/* Invalid/conflicting pending transactions are excluded. */}}
      const block=await chain.mine(wallet,[...node.pool.values()].slice(0,3),{maxAttempts:1000});
      await wallet.save(wf,pass);await chain.save(cf);await node.reconcile();
      const blockFile=cf+'.last-mined-block.json';await writeJSON(blockFile,block);
      let published=false;try{const result=await submitBlock(a[0],block,proxyOptions);published=result.accepted||result.known;}catch{/* A durable public block file permits retry without exposing keys. */}
      output({height:chain.height,block:block.id,transactions:block.transactions.length-1,published,blockFile,balance:wallet.scan(chain)});return;
    }
    if(cmd==='renew') {
      const notes=wallet.data.notes.filter(n=>!n.spent&&!n.reserved&&Number(n.lock)<=chain.blocks.length).sort((a,b)=>BigInt(a.value)>BigInt(b.value)?-1:1).slice(0,2);
      const amount=notes.reduce((sum,n)=>sum+BigInt(n.value),0n)-FEE;
      if(amount<=0n)throw Error('Not enough unlocked coins to renew');
      const tx=await buildTransaction(chain,wallet,{recipient:wallet.invoice(chain.config.domain,chain.activeSuite()),amount,inputs:notes});
      const file=a[2]??'data/renewal.json';
      if(await fs.access(file).then(()=>true,()=>false))throw Error('Renewal output already exists');
      const id=wallet.reserve(tx,chain);await wallet.save(wf,pass);await writeJSON(file,transactionPacket(chain,tx),0o600,{replace:false});
      output({transaction:id,file,inputsRenewed:notes.length,suite:chain.activeSuite(),notice:'원본 지출 증명과 새 보안 출력으로 갱신합니다. 블록에 포함된 뒤 기존 노트는 재사용할 수 없습니다.'});return;
    }
    let tx;
    if(cmd==='send'||cmd==='prepare')tx=await buildTransaction(chain,wallet,{recipient:a[0]?.startsWith('onlyprivacy:')?decodeAddress(a[0],chain.config.domain):await readJSON(a[0],10000),amount:parseAmount(a[1])});
    else if(cmd==='propose-upgrade') {
      const action=proposalAction(chain),recipient=wallet.invoice(chain.config.domain,chain.activeSuite());
      tx=await buildTransaction(chain,wallet,{recipient,amount:UNIT,action,stake:UNIT,stakeLock:action.closeHeight});
    }else if(cmd==='vote') {
      const proposal=chain.proposals.get(a[0]);if(!proposal)throw Error('Unknown proposal');
      tx=await buildTransaction(chain,wallet,{recipient:wallet.invoice(chain.config.domain,chain.activeSuite()),amount:UNIT,
        action:{type:'vote',proposal:a[0],choice:a[1]},stake:UNIT,stakeLock:proposal.closeHeight});
    }else throw Error('Unknown command. Use help.');
    if(cmd==='prepare') {
      const id=wallet.reserve(tx,chain),file=a[4]??'data/transaction.json';
      if(await fs.access(file).then(()=>true,()=>false))throw Error('Transaction output already exists; choose a new file');
      await wallet.save(wf,pass);await writeJSON(file,transactionPacket(chain,tx),0o600,{replace:false});
      output({transaction:id,file,validThroughHeight:tx.external.height+64,balance:wallet.balance(chain.blocks.length)});return;
    }
    // Persist newly issued change/reward keys before the public block can be saved.
    const block=await chain.mine(wallet,[tx],{maxAttempts:1000});
    await wallet.save(wf,pass);await chain.save(cf);output({height:chain.height,block:block.id,action:tx.external.action,balance:wallet.scan(chain)});
  });
}
try {await main(process.argv.slice(2));chain?.close();process.exit(0);}
catch(e){chain?.close();console.error(e.message);process.exit(1);}
