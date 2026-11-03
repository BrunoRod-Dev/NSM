export function summarizeStats(report,previous=new Map()){
 const next=new Map(),metrics={fps:null,loss:null,jitterMs:null,decodeMs:null,bufferMs:null,rttMs:null,kbps:null,audioBytes:null};
 for(const item of report.values()){
  if(item.type==='candidate-pair'&&item.state==='succeeded'&&item.nominated&&Number.isFinite(item.currentRoundTripTime))metrics.rttMs=item.currentRoundTripTime*1000;
  if(item.type==='inbound-rtp'&&item.kind==='audio')metrics.audioBytes=item.bytesReceived??null;
  if(item.type!=='inbound-rtp'||item.kind!=='video')continue;
  metrics.fps=Number.isFinite(item.framesPerSecond)?item.framesPerSecond:null;
  const total=(item.packetsReceived||0)+(item.packetsLost||0);if(total>0)metrics.loss=Math.max(0,item.packetsLost||0)/total*100;
  if(Number.isFinite(item.jitter))metrics.jitterMs=item.jitter*1000;
  const old=previous.get(item.id);
  if(old){
   const frames=item.framesDecoded-old.framesDecoded;if(frames>0)metrics.decodeMs=(item.totalDecodeTime-old.totalDecodeTime)/frames*1000;
   const emitted=item.jitterBufferEmittedCount-old.jitterBufferEmittedCount;if(emitted>0)metrics.bufferMs=(item.jitterBufferDelay-old.jitterBufferDelay)/emitted*1000;
   const ms=item.timestamp-old.timestamp;if(ms>0&&item.bytesReceived>=old.bytesReceived)metrics.kbps=(item.bytesReceived-old.bytesReceived)*8/ms;
  }
  next.set(item.id,item);
 }
 return {metrics,next};
}
export function formatMetrics(m){const n=(v,s)=>Number.isFinite(v)?`${Math.round(v)}${s}`:'—';return `Video: ${n(m.fps,' fps')} · ${n(m.kbps,' kb/s')} · pérdida ${n(m.loss,'%')} · red ${n(m.rttMs,' ms RTT')} · buffer ${n(m.bufferMs,' ms')} · decodificación ${n(m.decodeMs,' ms')} · audio ${m.audioBytes>0?'recibido':'sin datos'}`}
