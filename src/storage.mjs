import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import koffi from 'koffi';

let flock;
function processLock(fd,operation) {
  if(!flock) {
    if(!['darwin','linux'].includes(process.platform))throw Error('Process locking currently requires macOS or Linux');
    const libc=koffi.load(process.platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6');
    flock=libc.func('int flock(int fd, int operation)');
  }
  return flock(fd,operation);
}
export async function writeJSON(file,data,mode=0o600,{replace=true}={}) {
  await fs.mkdir(path.dirname(path.resolve(file)),{recursive:true,mode:0o700});
  const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  let handle,replacementVisible=false;
  try {
    handle=await fs.open(temporary,'wx',mode);
    await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();await handle.close();handle=null;
    if(replace)await fs.rename(temporary,file);else await fs.link(temporary,file);
    replacementVisible=true;
    const directory=await fs.open(path.dirname(path.resolve(file)),'r');
    try{await directory.sync();}finally{await directory.close();}
  }catch(error){error.replacementVisible=replacementVisible;throw error;}
  finally {await handle?.close();await fs.rm(temporary,{force:true});}
}
export async function readJSON(file,max=16*1024*1024) {
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>max)throw Error('Invalid file or size limit');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
export async function exclusive(file,fn) {
  await fs.mkdir(path.dirname(path.resolve(file)),{recursive:true,mode:0o700});
  // Keep the lock inode in place: unlinking it creates an interprocess race.
  // The OS releases flock automatically even after SIGKILL or a process crash.
  const handle=await fs.open(file+'.lock','a+',0o600);let locked=false;
  try {
    if(processLock(handle.fd,2|4)!==0)throw Error('File is in use by another process; retry after it finishes');
    locked=true;return await fn();
  }finally{if(locked)processLock(handle.fd,8);await handle.close();}
}
export async function exclusiveMany(files,fn) {
  const ordered=[...new Set(files.map(file=>path.resolve(file)))].sort();
  const acquire=index=>index===ordered.length?fn():exclusive(ordered[index],()=>acquire(index+1));
  return acquire(0);
}
