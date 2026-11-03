// Full snapshots recover from dropped packets; sequence numbers reject reordering.
export class InputState {
 constructor(write){this.write=write;this.sequence=-1;this.mask=0;this.last=0}
 accept(data,now){
  if(data?.type!=='input'||!Number.isSafeInteger(data.sequence)||data.sequence<0||data.sequence<=this.sequence||!Number.isInteger(data.mask)||data.mask<0||data.mask>65535)return false;
  this.sequence=data.sequence;this.last=now;this.update(data.mask);return true;
 }
 update(mask){const changed=this.mask^mask;for(let i=0;i<16;i++)if(changed&(1<<i))this.write(i,(mask>>i)&1);this.mask=mask}
 release(){this.update(0)}
 expire(now,timeout=1000){if(now-this.last>timeout)this.release()}
}
