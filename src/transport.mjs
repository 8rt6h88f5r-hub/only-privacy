import net from 'node:net';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { canonical } from './primitives.mjs';

// Only v3 onion names are accepted. No DNS lookup or direct-Internet fallback.
export function onionEndpoint(text) {
  const url=new URL(text);
  if(url.protocol!=='http:'||!/^([a-z2-7]{56})\.onion$/.test(url.hostname)||url.username||url.password||url.hash||url.search||url.pathname!=='/')throw Error('An http://v3-onion-address:port/ endpoint is required');
  const port=Number(url.port||80);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid onion port');
  return {host:url.hostname,port};
}
function socksConnection(endpoint,proxyPort=9050,{signal}={}) {
  return new Promise((resolve,reject)=>{
    if(!Number.isInteger(proxyPort)||proxyPort<1||proxyPort>65535)return reject(Error('Invalid local Tor proxy port'));
    const socket=net.connect({host:'127.0.0.1',port:proxyPort}),isolation=randomBytes(16).toString('hex');
    let buffer=Buffer.alloc(0),stage=0,settled=false;
    const cleanup=()=>{socket.off('data',receive);socket.off('error',fail);socket.off('end',closed);socket.off('close',closed);signal?.removeEventListener('abort',aborted);socket.setTimeout(0);};
    const fail=e=>{if(settled)return;settled=true;cleanup();socket.destroy();reject(e);};
    const aborted=()=>fail(Error('Peer request cancelled'));
    const closed=()=>fail(Error('Tor proxy closed during negotiation'));
    socket.once('end',closed);socket.once('close',closed);
    socket.setTimeout(15000,()=>fail(Error('Tor proxy timeout')));socket.once('error',fail);
    signal?.addEventListener('abort',aborted,{once:true});
    // Tor IsolateSOCKSAuth separates this stream from other application requests.
    socket.once('connect',()=>socket.write(Buffer.from([5,1,2])));
    const receive=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>4096)return fail(Error('Oversized SOCKS reply'));
      if(stage===0&&buffer.length>=2) {
        if(buffer[0]!==5||buffer[1]!==2)return fail(Error('Tor SOCKS5 authentication isolation unavailable'));
        buffer=buffer.subarray(2);stage=1;const credential=Buffer.from(isolation);
        socket.write(Buffer.concat([Buffer.from([1,credential.length]),credential,Buffer.from([credential.length]),credential]));
      }
      if(stage===1&&buffer.length>=2) {
        if(buffer[0]!==1||buffer[1]!==0)return fail(Error('Tor SOCKS authentication failed'));
        buffer=buffer.subarray(2);stage=2;socket.setTimeout(60000,()=>fail(Error('Tor onion connection timeout')));const host=Buffer.from(endpoint.host),port=Buffer.alloc(2);port.writeUInt16BE(endpoint.port);
        socket.write(Buffer.concat([Buffer.from([5,1,0,3,host.length]),host,port]));
      }
      if(stage===2&&buffer.length>=5) {
        if(buffer[0]!==5||buffer[1]!==0||buffer[2]!==0)return fail(Error('Tor refused onion connection'));
        const size=buffer[3]===1?10:buffer[3]===4?22:buffer[3]===3?7+buffer[4]:0;
        if(!size)return fail(Error('Invalid SOCKS address reply'));if(buffer.length<size)return;
        const rest=buffer.subarray(size);settled=true;cleanup();socket.pause();if(rest.length)socket.unshift(rest);resolve(socket);
      }
    };socket.on('data',receive);
    if(signal?.aborted)aborted();
  });
}

export async function peerRequest(endpointText,{path='/chain',method='GET',data,proxyPort=9050,signal,maxBytes=64*1024*1024}={}) {
  if(!['/chain','/tip','/pending','/transaction','/block'].includes(path)&&!/^\/range\?from=[0-9]{1,10}&count=[12]$/.test(path)||!['GET','POST'].includes(method))throw Error('Unsupported peer request');
  const endpoint=onionEndpoint(endpointText),socket=await socksConnection(endpoint,proxyPort,{signal});
  return new Promise((resolve,reject)=>{
    const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>socket;
    const body=data===undefined?null:Buffer.from(canonical(data));
    const headers={'Accept':'application/json','Connection':'close'};
    if(body){headers['Content-Type']='application/json';headers['Content-Length']=body.length;}
    const req=http.request({method,host:endpoint.host,port:endpoint.port,path,agent,headers,signal},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>maxBytes)req.destroy(Error('Peer response too large'));else chunks.push(c);});
      res.on('end',()=>{if(res.statusCode!==200)return reject(Error('Peer rejected request: '+res.statusCode));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Invalid peer response'));}});
      res.on('error',reject);res.on('aborted',()=>reject(Error('Peer response interrupted')));
    });
    const deadline=setTimeout(()=>req.destroy(Error('Peer deadline exceeded')),45000);
    req.setTimeout(30000,()=>req.destroy(Error('Peer timeout')));
    req.once('socket',connected=>connected.resume());
    req.on('error',reject);req.on('close',()=>{clearTimeout(deadline);agent.destroy();});req.end(body);
  });
}
export const fetchPeerChain=(endpoint,options={})=>peerRequest(endpoint,options);
export const fetchPending=(endpoint,options={})=>peerRequest(endpoint,{...options,path:'/pending',maxBytes:256*1024*1024});
export const submitTransaction=(endpoint,packet,options={})=>peerRequest(endpoint,{...options,path:'/transaction',method:'POST',data:packet,maxBytes:4096});
export const submitBlock=(endpoint,block,options={})=>peerRequest(endpoint,{...options,path:'/block',method:'POST',data:block,maxBytes:4096});

export function serveNode(node,{port=18773}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid public node port');
  let active=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>{if(!res.destroyed){let body;try{body=JSON.stringify(data);}catch{node.halted=true;return send(503,{error:'Public data temporarily unavailable'});}res.writeHead(status);res.end(body);}};
    if(active>=8)return send(503,{error:'Node busy'});
    active++;res.once('close',()=>active--);
    const chain=node.chain;
    if(req.headers.origin)return send(403,{error:'Browser origins are not accepted'});
    try{
      if(req.method==='GET'&&req.url==='/tip')return send(200,{protocol:chain.config.protocol,genesis:chain.blocks[0].id,height:chain.height,id:chain.blocks.at(-1).id,work:chain.work.toString(),storageHalted:node.halted,pendingDurable:node.poolDurable});
      if(req.method==='GET'&&req.url==='/chain'){if(chain.blocks.length>2)return send(413,{error:'Use bounded range synchronization'});return send(200,chain.data());}
      if(req.method==='GET'&&/^\/range\?from=[0-9]{1,10}&count=[12]$/.test(req.url)){const u=new URL(req.url,'http://localhost'),from=Number(u.searchParams.get('from')),count=Number(u.searchParams.get('count'));return send(200,{genesis:chain.blocks[0].id,configuration:chain.blocks[0].header.configuration,blocks:chain.blocks.slice(from,from+count)});}
      if(req.method==='GET'&&req.url==='/pending')return send(200,{packets:node.packets(3).slice(0,3)});
    }catch{node.halted=true;return send(503,{error:'Public data temporarily unavailable'});}
    if(req.method!=='POST'||!['/block','/transaction'].includes(req.url))return send(404,{error:'Public chain endpoints only'});
    const limit=req.url==='/block'?24*1024*1024:6*1024*1024+1024;
    if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
    if(Number(req.headers['content-length'])>limit)return send(413,{error:'Request too large'});
    let size=0;const chunks=[];
    req.on('data',c=>{size+=c.length;if(size>limit)req.destroy();else chunks.push(c);});
    req.on('error',()=>{});
    req.on('end',async()=>{
      try {
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result=await (req.url==='/block'?node.acceptBlock(data):node.acceptTransaction(data));send(200,result);
      }catch{send(400,{error:'Rejected by node validation or persistence'});}
    });
  });
  server.headersTimeout=10000;server.requestTimeout=30000;server.maxConnections=32;
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=1;server.setTimeout(30000,socket=>socket.destroy());
  server.listen(port,'127.0.0.1');return server;
}
