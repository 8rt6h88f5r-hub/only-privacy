export const UNIT=10n**12n;
export const INITIAL=10000n*UNIT;
export const ANNUAL=100n*UNIT;
export const YEAR=365*24*60*60;
export const TARGET=120;
export const BLOCKS_PER_YEAR=YEAR/TARGET;
export const FEE=1000000n;
export function baseReward(height) {
  const h=BigInt(height), n=BigInt(BLOCKS_PER_YEAR);
  return (h*ANNUAL)/n-((h-1n)*ANNUAL)/n;
}
export function subsidy(history,timestamp) {
  if(!Number.isSafeInteger(timestamp)||timestamp<=history[0].timestamp) return 0n;
  const issued=history.slice(1).reduce((s,b)=>s+BigInt(b.subsidy),0n);
  const recent=history.slice(1).filter(b=>b.timestamp>timestamp-YEAR).reduce((s,b)=>s+BigInt(b.subsidy),0n);
  const unlocked=(ANNUAL*BigInt(timestamp-history[0].timestamp))/BigInt(YEAR);
  const credit=unlocked>issued?unlocked-issued:0n;
  const room=ANNUAL>recent?ANNUAL-recent:0n;
  return [baseReward(history.length),credit,room].reduce((a,b)=>a<b?a:b);
}
export function formatAmount(value) {
  const n=BigInt(value), whole=n/UNIT, frac=(n%UNIT).toString().padStart(12,'0').replace(/0+$/,'');
  return whole.toString()+(frac?'.'+frac:'');
}
export function parseAmount(text) {
  if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/.test(text)) throw Error('Amount requires at most 12 decimal places');
  const [w,f='']=text.split('.');const n=BigInt(w)*UNIT+BigInt(f.padEnd(12,'0'));
  if(n>=(1n<<63n)) throw Error('Amount exceeds note range'); return n;
}

export const OWNER_ALLOCATION=100n*UNIT;
export const MINER_RESERVE=9900n*UNIT;
export const RESERVE_YEARS=10;
export const RESERVE_BLOCKS=BLOCKS_PER_YEAR*RESERVE_YEARS;
export function reserveReward(history,timestamp){
  const h=history.length;if(timestamp<=history[0].timestamp)return 0n;
  const paid=history.slice(1).reduce((s,b)=>s+BigInt(b.reserveRelease??0),0n);
  const credit=(MINER_RESERVE*BigInt(timestamp-history[0].timestamp))/BigInt(YEAR*RESERVE_YEARS);
  const scheduled=(BigInt(h)*MINER_RESERVE)/BigInt(RESERVE_BLOCKS)-(BigInt(h-1)*MINER_RESERVE)/BigInt(RESERVE_BLOCKS);
  return [scheduled,credit>paid?credit-paid:0n,MINER_RESERVE-paid].reduce((a,b)=>a<b?a:b);
}
