import koffi from 'koffi';
import path from 'node:path';
import { PROJECT } from './proofs.mjs';
import { sha,canonical } from './primitives.mjs';
export class RandomX {
  constructor() {
    const filename=process.platform==='darwin'?'librandomx.dylib':process.platform==='win32'?'randomx.dll':'librandomx.so';
    const lib=koffi.load(path.join(PROJECT,'native',filename));
    this.allocate=lib.func('void *randomx_alloc_cache(int flags)');
    this.init=lib.func('void randomx_init_cache(void *cache, const void *key, size_t size)');
    this.create=lib.func('void *randomx_create_vm(int flags, void *cache, void *dataset)');
    this.calc=lib.func('void randomx_calculate_hash(void *vm, const void *input, size_t size, _Out_ void *output)');
    this.destroy=lib.func('void randomx_destroy_vm(void *vm)');
    this.release=lib.func('void randomx_release_cache(void *cache)');
    // Light mode: 256 MiB cache, portable interpreter, no JIT executable memory.
    this.cache=this.allocate(0);if(!this.cache)throw Error('RandomX needs a 256 MiB cache');this.vm=null;this.key=null;
  }
  hashBytes(input,keyBytes) {
    const key=keyBytes.toString('hex');
    if(this.key!==key) {
      if(this.vm)this.destroy(this.vm);
      this.init(this.cache,keyBytes,keyBytes.length);
      this.vm=this.create(0,this.cache,null);if(!this.vm)throw Error('RandomX VM failed');this.key=key;
    }
    const out=Buffer.alloc(32);this.calc(this.vm,input,input.length,out);return out.toString('hex');
  }
  hash(data,key) {return this.hashBytes(Buffer.from(canonical(data)),Buffer.from(key,'hex'));}
  close() {if(this.vm)this.destroy(this.vm);if(this.cache)this.release(this.cache);this.vm=null;this.cache=null;}
}
export function miningKey(history,domain) {
  const height=history.length;
  const seed=height<64?0:Math.floor((height-64)/2048)*2048;
  return sha({domain,randomxSeed:history[seed].id});
}
export function difficulty(history) {
  if(history.length<11)return 1n;
  const tail=history.slice(-10),elapsed=Math.max(1,tail.at(-1).timestamp-tail[0].timestamp);
  const old=BigInt(tail.at(-1).difficulty),target=BigInt(120*(tail.length-1));
  const calculated=old*target/BigInt(elapsed),lo=old/4n||1n,hi=old*4n;
  return calculated<lo?lo:calculated>hi?hi:calculated||1n;
}
export function satisfies(hash,diff) {return BigInt('0x'+hash)<=((1n<<256n)-1n)/BigInt(diff);}
