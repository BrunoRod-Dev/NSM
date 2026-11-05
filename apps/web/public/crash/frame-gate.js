import { InputState } from './input-state.js';

// Install before Emscripten captures the callbacks during runtime initialization.
export function installFrameGate(emulator, gate) {
  const original = emulator.initModule;
  emulator.initModule = async function (...args) {
    gate.coreHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', args[0]))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const runtime = window.EJS_Runtime;
    window.EJS_Runtime = options => runtime({
      ...options,
      preMainLoop: () => gate.before(),
      postMainLoop: () => gate.after(),
    });
    try { return original.apply(this, args); }
    finally { window.EJS_Runtime = runtime; }
  };
}

export class FrameGate {
  constructor(onBatch, onError) {
    this.onBatch = onBatch;
    this.onError = onError;
    this.remaining = 0;
    this.frame = 0;
  }
  bind(manager) {
    this.manager = manager;
    this.pads = Array.from({ length: 4 }, (_, seat) =>
      new InputState((button, value) => manager.simulateInput(seat, button, value)));
    manager.toggleMainLoop(1);
  }
  before() {
    if (!this.manager || !this.remaining) return false;
    this.beforeFrame = this.manager.getFrameNum();
    return true;
  }
  after() {
    if (!this.manager || !this.remaining) return;
    const elapsed = this.manager.getFrameNum() - this.beforeFrame;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > this.remaining) {
      this.remaining = 0;
      this.onError('El emulador avanzó fuera del cuadro acordado.');
      return;
    }
    this.remaining -= elapsed;
    this.frame += elapsed;
    if (!this.remaining) this.onBatch();
  }
  run(masks, frames = 4) {
    if (this.remaining) throw new Error('El lote anterior todavía está ejecutándose.');
    masks.forEach((mask, seat) => this.pads[seat].update(mask));
    this.remaining = frames;
  }
  stop() { this.remaining = 0; }
  reset() {
    this.stop();
    this.frame = 0;
    this.pads.forEach(pad => { pad.mask = 0; });
    for (let seat = 0; seat < 4; seat++)
      for (let button = 0; button < 16; button++) this.manager.simulateInput(seat, button, 0);
  }
}
