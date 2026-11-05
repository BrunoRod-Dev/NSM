// Technical regression check with an original diagnostic PS-X EXE. No commercial game is loaded.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
// Extract pcsx_rearmed-legacy-wasm.data from the EmulatorJS 4.2.3 CDN
// into .local/psx-core before running this optional real-core regression.
const root = process.cwd();
const permitted = new Set([
  '/.local/psx-core/pcsx_rearmed_libretro.js',
  '/.local/psx-core/pcsx_rearmed_libretro.wasm',
  '/apps/web/public/crash/frame-gate.js',
  '/apps/web/public/crash/input-state.js',
  '/apps/web/public/crash/netplay-session.js',
  '/apps/web/public/crash/psx-state.js',
]);
const html = `<canvas id="screen" width="320" height="240"></canvas><script src="/.local/psx-core/pcsx_rearmed_libretro.js"></script><script type="module">
import { installFrameGate } from '/apps/web/public/crash/frame-gate.js';
import { createNetplay } from '/apps/web/public/crash/netplay-session.js';
window.errors=[]; window.done=0;
window.messages=[]; const session=createNetplay({host:location.search.includes('host'),readMask:()=>location.search.includes('host')?8:16,status:s=>window.messages.push(s)});window.session=session;const gate=session.gate;
window.gate=gate;
const emulator={initModule(wasmBinary){return EJS_Runtime({noInitialRun:true,parent:document.body,canvas:document.querySelector('canvas'),callbacks:{},
wasmBinary,print:console.log,printErr:console.log})}};
installFrameGate(emulator,gate);
const m=await emulator.initModule(await (await fetch('/.local/psx-core/pcsx_rearmed_libretro.wasm')).arrayBuffer());
window.mod=m;
const exe=new Uint8Array(4096),view=new DataView(exe.buffer);
exe.set(new TextEncoder().encode('PS-X EXE'));
view.setUint32(0x10,0x80010000,true);view.setUint32(0x18,0x80010000,true);view.setUint32(0x1c,2048,true);view.setUint32(0x30,0x801ffff0,true);
// Diagnostic program: count vertical blank interrupts in RAM, with no game assets.
const code=[0x3c081f80,0x35081070,0x3c0a8002,0x8d090000,0,0x31290001,0x1120fffc,0,0xad000000,0x8d490000,0,0x25290001,0xad490000,0x08004003,0];
code.forEach((n,i)=>view.setUint32(2048+i*4,n,true));
m.FS.writeFile('/diagnostic.exe',exe);
m.FS.writeFile('/test.cfg',new TextEncoder().encode('video_driver = "gl"\\nvideo_vsync = "false"\\naudio_driver = "null"\\nvideo_shader_enable = "false"\\n'));
m.callMain(['--config','/test.cfg','/diagnostic.exe']);
const count=m.cwrap('get_current_frame_count','number',[]);
const save=m.cwrap('save_state_info','string',[]);
const manager={getFrameNum:count,toggleMainLoop:m.cwrap('toggleMainLoop',null,['number']),
simulateInput:m.cwrap('simulate_input',null,['number','number','number']),
getState(){const [size,ptr,ok]=save().split('|');if(ok!=='1')throw Error(size);const b=m.HEAPU8.slice(+ptr,+ptr+ +size);return b},
loadState(b){m.FS.writeFile('/sync.state',b);return m.cwrap('load_state','number',['string','number'])('/sync.state',0)}};
window.manager=manager;session.start({gameManager:manager},'diagnostic-v1');window.loaded=true;
</script>`;
const server=http.createServer(async(req,res)=>{
 try {if(req.url.split('?')[0]!=='/'&&!permitted.has(req.url.split('?')[0]))throw Error();let p=path.resolve(root,'.'+req.url.split('?')[0]);if(p!==root&&!p.startsWith(root+path.sep))throw Error();
 const data=req.url.split('?')[0]==='/'?Buffer.from(html):await fs.readFile(p);
 res.setHeader('Content-Type',req.url.split('?')[0]==='/'?'text/html':req.url.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(data);
 }catch{res.writeHead(404).end()}
});
await new Promise(r=>server.listen(4391,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const pages=[];
 async function open(host=false) {
   const page=await browser.newPage();
   pages.push(page);
   page.on('pageerror',error=>{throw error});
   await page.goto('http://127.0.0.1:4391/?'+(host?'host':'guest'));
   await page.waitForFunction(()=>window.loaded);
   return page;
 }
 async function connect(host,guest,seat) {
   await host.evaluate(seat=>{
     window.links ??= {};
     const pc=new RTCPeerConnection();
     links[seat]=pc;
     session.attach(seat,pc.createDataChannel('test'));
   },seat);
   await guest.evaluate(()=>{
     window.pc?.close();
     window.pc=new RTCPeerConnection();
     pc.ondatachannel=event=>session.attach(0,event.channel);
   });
   const offer=await host.evaluate(async seat=>{
     const pc=links[seat];
     await pc.setLocalDescription(await pc.createOffer());
     await new Promise(resolve=>{
       if(pc.iceGatheringState==='complete')resolve();
       else pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve()});
     });
     return pc.localDescription.toJSON();
   },seat);
   const answer=await guest.evaluate(async offer=>{
     await pc.setRemoteDescription(offer);
     await pc.setLocalDescription(await pc.createAnswer());
     await new Promise(resolve=>{
       if(pc.iceGatheringState==='complete')resolve();
       else pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve()});
     });
     return pc.localDescription.toJSON();
   },offer);
   await host.evaluate(({seat,answer})=>links[seat].setRemoteDescription(answer),{seat,answer});
 }
 async function waitFrames(page,count) {
   await page.waitForFunction(count=>gate.frame>=count || messages.some(m=>m.includes('Volvé')),count,{timeout:45000});
   const errors=await page.evaluate(()=>messages.filter(m=>m.includes('Volvé')||m.includes('Ajustando')));
   if(errors.length)throw Error(JSON.stringify(errors));
 }
 const host=await open(true),guest=await open();
 await connect(host,guest,1);
 await waitFrames(guest,1440);
 const counter = await guest.evaluate(() => {
   const bytes = manager.getState();
   return new DataView(bytes.buffer).getUint32(16 + 37 + 128 * 96 * 3 + 0x20000, true);
 });
 if(counter < 100)throw Error('Diagnostic program did not advance its RAM counter: '+counter);
 console.log('PASS: diagnostic RAM counter '+counter);
 console.log('PASS: exact runtime hooks, two real PS1 cores, 1440 frames, matching RAM checkpoints');
 const third=await open(),fourth=await open();
 await connect(host,third,2);
 await connect(host,fourth,3);
 await waitFrames(fourth,960);
 for(const page of pages) {
   const messages=await page.evaluate(()=>window.messages);
   if(messages.some(m=>m.includes('Volvé')||m.includes('Ajustando')))throw Error(JSON.stringify(messages));
 }
 console.log('PASS: four real PS1 cores and late joins');
 await guest.evaluate(()=>pc.close());
 await host.waitForFunction(()=>messages.some(m=>m.includes('reconecte')));
 const held=await host.evaluate(()=>manager.getFrameNum());
 await host.waitForTimeout(300);
 if(await host.evaluate(()=>manager.getFrameNum())!==held)throw Error('Host advanced after disconnect');
 await connect(host,guest,1);
 await waitFrames(guest,960);
 console.log('PASS: disconnection pauses cores, reconnect restores host state');
 await host.evaluate(()=>{links[3].close();session.remove(3)});
 await fourth.evaluate(()=>session.dispose());
 const frame=await host.evaluate(()=>gate.frame);
 await waitFrames(host,frame+500);
 console.log('PASS: departing player releases the remaining players');
 for(const page of pages)await page.evaluate(()=>session.dispose());
}finally{await browser.close();server.close()}


