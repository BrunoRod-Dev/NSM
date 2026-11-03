import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only automated tests use this generated canvas/audio source. It is not a game ROM.
export async function createGameFixture() {
  const dir = resolve('.local/crash-test');
  await Promise.all(['archivos/juego', 'archivos/bios', 'runtime'].map(path => mkdir(resolve(dir, path), { recursive: true })));
  await writeFile(resolve(dir, 'archivos/juego/test.chd'), 'NSM TEST FIXTURE - NOT A GAME');
  await writeFile(resolve(dir, 'archivos/bios/test.bin'), 'NSM TEST FIXTURE - NOT A BIOS');
  await writeFile(resolve(dir, 'runtime/loader.js'), `
    const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=480;
    canvas.style.cssText='width:100%;height:100%;object-fit:contain'; document.querySelector('#game').append(canvas);
    const context = canvas.getContext('2d'); let frame=0;
    setInterval(()=>{context.fillStyle='#12304b';context.fillRect(0,0,640,480);context.fillStyle='#9ed8b5';context.fillRect((frame++*3)%560,190,80,80);context.fillStyle='#fff';context.font='22px sans-serif';context.fillText('PRUEBA WEBRTC GENERADA - SIN EMULADOR',30,80)},33);
    const audioCtx = new AudioContext(); const oscillator=audioCtx.createOscillator(); const gain=audioCtx.createGain(); gain.gain.value=0.001;oscillator.connect(gain);gain.connect(audioCtx.destination);oscillator.start();void audioCtx.resume();
    window.__nsmTestInputs=[];
    window.EJS_emulator={canvas,Module:{AL:{currentCtx:{audioCtx,sources:{one:{gain}}}}},gameManager:{simulateInput:(seat,index,value)=>window.__nsmTestInputs.push({seat,index,value}),functions:{setVariable(){}},setVSync(){}}};
    window.EJS_onGameStart?.();
  `);
  return dir;
}
