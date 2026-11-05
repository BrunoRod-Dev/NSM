import { InputState } from './input-state.js';

// Both cores advance in short batches with identical controller masks.
// The next batch requires the guest to have finished the previous one.
export function connectLocalRace(channel, host, readMask, status, version, disconnected = status) {
  channel.binaryType = 'arraybuffer';
  const emu = window.EJS_emulator;
  const manager = emu.gameManager;
  const previousLoop = emu.Module.postMainLoop;
  const pads = [0, 1].map(seat => new InputState((button, value) => manager.simulateInput(seat, button, value)));
  let remaining = 0, batch = 0, guestReady, initialized = false, ended = false;
  let snapshot, offset = 0, beacon, greeted = false;
  function hold() { manager.toggleMainLoop(0); }
  function send(data) { channel.send(JSON.stringify(data)); }
  function close(reason) {
    if (ended) return;
    ended = true;
    clearInterval(beacon);
    hold();
    pads.forEach(pad => pad.release());
    emu.Module.postMainLoop = previousLoop;
    disconnected(reason);
    channel.close();
  }
  function advance(masks) {
    masks.forEach((mask, seat) => pads[seat].update(mask));
    remaining = 4;
    manager.toggleMainLoop(1);
  }
  function next() {
    if (!initialized || remaining || guestReady === undefined) return;
    const masks = [readMask(), guestReady];
    guestReady = undefined;
    send({ type: 'run', batch, masks });
    advance(masks);
  }
  hold();
  emu.Module.postMainLoop = (...args) => {
    previousLoop?.apply(emu.Module, args);
    if (remaining && --remaining === 0) {
      hold();
      batch++;
      if (host) next();
      else send({ type: 'ready', batch, mask: readMask() });
    }
  };
  const validMask = n => Number.isInteger(n) && n >= 0 && n <= 65535;
  channel.onclose = () => close('Se cortó la carrera local. Volvé a entrar para sincronizar desde el anfitrión.');
  channel.onmessage = async ({ data }) => {
    try {
      if (data instanceof ArrayBuffer) {
        if (host || !snapshot || offset + data.byteLength > snapshot.length) throw Error();
        snapshot.set(new Uint8Array(data), offset); offset += data.byteLength;
        return;
      }
      const msg = JSON.parse(data);
      if (!host && msg.type === 'host-ready') {
        if (!greeted) { send({ type: 'hello', version }); greeted = true; }
      } else if (host && msg.type === 'hello' && !initialized) {
        clearInterval(beacon);
        if (msg.version !== version) throw Error('Las versiones instaladas de CTR no coinciden.');
        initialized = true;
        status('Preparando estado inicial de CTR…');
        const bytes = new Uint8Array(manager.getState());
        if (!bytes.length || bytes.length > 32*1024*1024) throw Error('El emulador devolvió un estado inicial inválido.');
        send({ type: 'state', size: bytes.length });
        for (let i = 0; i < bytes.length; i += 16384) {
          while (!ended && channel.bufferedAmount > 262144) await new Promise(resolve => setTimeout(resolve, 10));
          if (ended) return;
          channel.send(bytes.subarray(i, i + 16384));
        }
        send({ type: 'start' });
      } else if (!host && !initialized && msg.type === 'state' && !snapshot && Number.isSafeInteger(msg.size) && msg.size > 0 && msg.size <= 32*1024*1024) {
        status('Recibiendo el estado inicial de CTR…');
        snapshot = new Uint8Array(msg.size);
      } else if (!host && msg.type === 'start' && snapshot && offset === snapshot.length) {
        manager.loadState(snapshot); snapshot = undefined; initialized = true;
        send({ type: 'ready', batch, mask: readMask() });
        status('CTR local · Jugador 2');
      } else if (host && initialized && msg.type === 'ready' && (msg.batch === batch || remaining && msg.batch === batch+1) && validMask(msg.mask)) {
        if (!msg.batch) status('CTR local · Jugador 1');
        guestReady = msg.mask; next();
      } else if (!host && initialized && !remaining && msg.type === 'run' && msg.batch === batch && msg.masks?.length === 2 && msg.masks.every(validMask)) {
        advance(msg.masks);
      } else throw Error();
    } catch (error) { close('Falló la sincronización de CTR. ' + (error.message || 'Mensaje inesperado.') + ' El jugador 2 puede reconectar.'); }
  };
  if (host) {
    const announce = () => { if (channel.readyState === 'open') send({ type: 'host-ready' }); };
    beacon = setInterval(announce, 1000);
    announce();
  }
  return () => close('Sincronizando nuevamente…');
}
