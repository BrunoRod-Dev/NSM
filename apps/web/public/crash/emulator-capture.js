// Adapter for the pinned EmulatorJS 4.2.3 OpenAL audio graph.
// Connecting a second destination preserves the emulator's speaker output.
export function captureEmulator(emulator,fps=50){
 const canvas=emulator?.canvas;
 const al=emulator?.Module?.AL?.currentCtx;
 if(!canvas?.captureStream||!canvas.width||!canvas.height)throw Error('La imagen del juego todavía no está lista');
 if(!al?.audioCtx)throw Error('La salida directa de audio no está disponible; usá Compartir pestaña');
 const destination=al.audioCtx.createMediaStreamDestination();
 const connected=new Set();let timer,stream;
 const connectSources=()=>{for(const source of Object.values(al.sources||{})){const node=source?.gain;if(node&&!connected.has(node)){node.connect(destination);connected.add(node)}}};
 const dispose=()=>{clearInterval(timer);for(const node of connected){try{node.disconnect(destination)}catch{}}connected.clear();stream?.getTracks().forEach(t=>t.stop());destination.stream.getTracks().forEach(t=>t.stop())};
 try{
  connectSources();if(!connected.size)throw Error('El audio del juego aún no está listo; esperá a que suene o usá Compartir pestaña');
  stream=new MediaStream([...canvas.captureStream(fps).getVideoTracks(),...destination.stream.getAudioTracks()]);
  if(!stream.getVideoTracks().length||!stream.getAudioTracks().length)throw Error('No se pudieron obtener las pistas del juego');
  timer=setInterval(connectSources,500);return {stream,dispose};
 }catch(e){dispose();throw e}
}
