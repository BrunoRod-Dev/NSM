import { gameMemory } from './psx-state.js';
import { FrameGate } from './frame-gate.js';

const digest = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
const validMask = value => Number.isInteger(value) && value >= 0 && value <= 65535;

export function createNetplay({ host, readMask, status, memory = gameMemory }) {
  const peers = new Map();
  let manager, version, booted = false, stopped = false, syncing = false;
  let epoch = 0, batch = 0, restart = true, guestReady = false, incoming;
  let localChecksum, checking = false, membership = 0;
  let resyncs = 0, completedFrames = 0, measuredFps = 0;
  let sampleAt = performance.now(), sampledFrames = 0;
  let waitSince = 0, lastWait = 0;
  const send = (peer, value) => {
    if (peer.channel.readyState !== 'open') throw Error('Se perdió la conexión con un jugador.');
    peer.channel.send(JSON.stringify(value));
  };
  const fail = reason => {
    if (stopped) return;
    stopped = true;
    gate.stop();
    status(reason + ' Volvé a abrir la sala para reconectar.');
    for (const peer of peers.values()) {
      try { send(peer, { type: 'failed', reason }); } catch {}
    }
  };
  const gate = new FrameGate(() => { void completed().catch(error => fail(error.message)); }, fail);

  async function completed() {
    if (stopped) return;
    if (!booted) {
      booted = true;
      status(host ? 'Juego preparado. Esperando jugadores…' : 'Juego preparado. Conectando con el anfitrión…');
      return;
    }
    completedFrames += 4;
    const now = performance.now();
    if (now - sampleAt >= 1000) {
      measuredFps = Math.round((completedFrames - sampledFrames) * 1000 / (now - sampleAt));
      sampledFrames = completedFrames; sampleAt = now;
    }
    batch++;
    const completedEpoch = epoch;
    if (batch % 120 === 0) {
      checking = true;
      try { localChecksum = await digest(memory(manager.getState())); }
      finally { checking = false; }
    } else localChecksum = undefined;
    if (stopped || epoch !== completedEpoch) return;
    if (host) advance();
    else {
      const peer = peers.get(0);
      if (peer) send(peer, { type: 'done', epoch, batch, mask: readMask(), checksum: localChecksum });
    }
  }
  function advance() {
    if (!host || stopped || !booted || syncing || checking || gate.remaining) return;
    if (restart) { void synchronize().catch(error => fail(error.message)); return; }
    const masks = [readMask(), 0, 0, 0];
    for (const [seat, peer] of peers) {
      if (!peer.hello || peer.channel.readyState !== 'open' || peer.done !== batch) {
        if (!waitSince) waitSince = performance.now();
        return;
      }
      if (localChecksum && peer.checksum !== localChecksum) {
        resyncs++;
        restart = true;
        status('Ajustando la sincronización de los jugadores…');
        void synchronize().catch(error => fail(error.message));
        return;
      }
      masks[seat] = peer.mask;
    }
    if (waitSince) { lastWait = Math.round(performance.now() - waitSince); waitSince = 0; }
    for (const peer of peers.values()) send(peer, { type: 'run', epoch, batch, masks });
    gate.run(masks);
  }
  async function synchronize() {
    if (syncing || gate.remaining || !booted || [...peers.values()].some(peer => !peer.hello || peer.channel.readyState !== 'open')) return;
    syncing = true;
    restart = false;
    const generation = membership;
    try {
      epoch++; batch = 0; localChecksum = undefined;
      gate.reset();
      const state = manager.getState();
      const save = manager.getSaveFile?.() ?? new Uint8Array();
      // Restore the coordinator too: PCSX normalizes internal execution state
      // on load, so all participants must cross the same restore boundary.
      manager.loadState(state);
      gate.reset();
      const bytes = new Uint8Array(state.length + save.length);
      bytes.set(state);
      bytes.set(save, state.length);
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 32 * 1024 * 1024) throw Error('No se pudo guardar el estado compartido.');
      const hash = await digest(bytes);
      if (generation !== membership || stopped) return;
      for (const [seat, peer] of peers) {
        peer.done = -1;
        send(peer, { type: 'snapshot', epoch, size: bytes.length, stateSize: state.length, hash, seat });
        for (let offset = 0; offset < bytes.length; offset += 16384) {
          while (!stopped && peers.get(seat) === peer && peer.channel.readyState === 'open' && peer.channel.bufferedAmount > 262144)
            await new Promise(resolve => setTimeout(resolve, 10));
          if (stopped || generation !== membership || peers.get(seat) !== peer || peer.channel.readyState !== 'open') return;
          peer.channel.send(bytes.subarray(offset, offset + 16384));
        }
        send(peer, { type: 'restore', epoch });
      }
      if (generation !== membership || stopped) return;
      status(peers.size ? 'Sincronizando la partida con tus amigos…' : 'Juego listo. Podés invitar a tus amigos.');
    } finally { syncing = false; }
    advance();
  }
  async function receive(seat, peer, data) {
    if (stopped || peers.get(seat) !== peer) return;
    if (data instanceof ArrayBuffer) {
      if (host || !incoming || incoming.offset + data.byteLength > incoming.bytes.length) throw Error('Estado de partida inválido.');
      incoming.bytes.set(new Uint8Array(data), incoming.offset);
      incoming.offset += data.byteLength;
      return;
    }
    const msg = JSON.parse(data);
    if (msg.type === 'failed') { fail('La partida se detuvo en el otro equipo.'); return; }
    if (!host && msg.type === 'hello-request') {
      if (booted) send(peer, { type: 'hello', version });
      return;
    }
    if (host && msg.type === 'hello') {
      if (msg.version !== version) throw Error('Las versiones del juego o del emulador no coinciden.');
      if (!peer.hello) { peer.hello = true; restart = true; advance(); }
      return;
    }
    if (['run', 'done', 'restore'].includes(msg.type) && Number.isSafeInteger(msg.epoch) && msg.epoch < epoch) return;
    if (!booted) throw Error('El juego todavía no está preparado.');
    if (!host && msg.type === 'snapshot') {
      if (!Number.isSafeInteger(msg.epoch) || msg.epoch <= epoch || !Number.isSafeInteger(msg.size) || msg.size <= 0 || msg.size > 32 * 1024 * 1024 || !Number.isSafeInteger(msg.stateSize) || msg.stateSize <= 0 || msg.stateSize > msg.size) throw Error('Estado inicial inválido.');
      gate.stop(); guestReady = false;
      epoch = msg.epoch; batch = 0;
      incoming = { bytes: new Uint8Array(msg.size), offset: 0, hash: msg.hash, stateSize: msg.stateSize };
      status('Recibiendo la partida del anfitrión…');
      return;
    }
    if (!host && msg.type === 'restore' && msg.epoch === epoch && incoming) {
      if (incoming.offset !== incoming.bytes.length || await digest(incoming.bytes) !== incoming.hash) throw Error('El estado de partida llegó incompleto.');
      if (stopped || peers.get(seat) !== peer) return;
      const save = incoming.bytes.subarray(incoming.stateSize);
      if (save.length) {
        manager.FS.writeFile(manager.getSaveFilePath(), save);
        manager.loadSaveFiles();
      }
      manager.loadState(incoming.bytes.subarray(0, incoming.stateSize));
      incoming = undefined;
      gate.reset();
      guestReady = true;
      send(peer, { type: 'done', epoch, batch, mask: readMask() });
      status('Partida sincronizada. Tu control corresponde al jugador asignado en la sala.');
      return;
    }
    // Membership changes abandon the in-flight batch; remaining peers may still acknowledge it.
    if (host && restart && msg.type === 'done' && msg.epoch === epoch) return;
    if (host && msg.type === 'done' && msg.epoch === epoch && validMask(msg.mask) &&
        (msg.batch === batch || gate.remaining && msg.batch === batch + 1)) {
      peer.done = msg.batch; peer.mask = msg.mask; peer.checksum = msg.checksum;
      advance();
      return;
    }
    if (!host && guestReady && msg.type === 'run' && msg.epoch === epoch && msg.batch === batch &&
        !gate.remaining && msg.masks?.length === 4 && msg.masks.every(validMask)) {
      gate.run(msg.masks);
      return;
    }
    throw Error('La secuencia de cuadros de la partida no coincide.');
  }
  const timer = setInterval(() => {
    if (stopped || !booted) return;
    if (host) {
      try {
        for (const peer of peers.values()) {
          if (!peer.hello && peer.channel.readyState === 'open') send(peer, { type: 'hello-request' });
        }
        advance();
      } catch (error) { fail(error.message); }
    }
  }, 250);
  return {
    gate,
    start(engine, fingerprint) {
      manager = engine.gameManager;
      version = fingerprint;
      gate.bind(manager);
      gate.run([0, 0, 0, 0], 1);
    },
    attach(seat, channel) {
      if (stopped) return;
      const peer = { channel, done: -1, hello: false, mask: 0, queue: Promise.resolve() };
      membership++;
      peers.set(seat, peer);
      if (host) restart = true;
      else {
        if (booted) gate.stop();
        epoch = 0;
        batch = 0;
        incoming = undefined;
        guestReady = false;
      }
      channel.binaryType = 'arraybuffer';
      channel.onmessage = ({ data }) => {
        peer.queue = peer.queue.then(() => receive(seat, peer, data)).catch(error => fail(error.message));
      };
      channel.onclose = () => {
        if (peers.get(seat) !== peer || stopped) return;
        if (booted) gate.stop();
        membership++;
        if (host) restart = true;
        status('Esperando que el otro jugador reconecte…');
      };
    },
    remove(seat) { membership++; peers.delete(seat); restart = true; if (host) advance(); },
    dispose() { stopped = true; gate.stop(); clearInterval(timer); },
    summary() { const fps = performance.now() - sampleAt > 2000 ? 0 : measuredFps; return 'Avance: ' + fps + ' cuadros/s · Cuadros compartidos: ' + gate.frame + ' · Ronda: ' + epoch + ' · Resincronizaciones por diferencia: ' + resyncs + (host ? ' · Espera del otro equipo: ' + (waitSince ? Math.round(performance.now() - waitSince) : lastWait) + ' ms' : '') + (stopped ? ' · Detenida' : ''); },
  };
}
