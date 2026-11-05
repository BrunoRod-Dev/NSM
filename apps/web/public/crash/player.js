import { createNetplay } from './netplay-session.js';
import { installFrameGate } from './frame-gate.js';
import { setupMobilePlayer } from './mobile-player.js';
import { manifest, localFiles } from './library.js';
import { configureGame } from './game-adapters.js';
import { setupControls } from './player-controls.js';
import { InputState } from './input-state.js';
import { captureEmulator } from './emulator-capture.js';
import { summarizeStats, formatMetrics } from './rtc-metrics.js';
import { isAppleMobile, preferCompatibleVideo, setVideoProfile, validProfile } from './stream-profile.js';

const $ = selector => document.querySelector(selector);
document.querySelectorAll('.player-menu').forEach(menu => {
  menu.addEventListener('toggle', () => { if (menu.open) document.querySelectorAll('.player-menu').forEach(other => { if (other !== menu) other.open = false; }); });
  menu.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('.player-menu')) document.querySelectorAll('.player-menu').forEach(menu => { menu.open = false; }); });
const roomId = location.pathname.split('/')[4];
const base = `/api/games/rooms/${roomId}`;
const clientId = crypto.randomUUID();
const peers = new Map();
let netplay, installedVersion;
let bootStatus = 'Sin iniciar';
const message = text => { $('#status').textContent = text; };
const bootMessage = text => { bootStatus = text; message(text); };
const quality = $('#stream-quality');
quality.value = isAppleMobile() || matchMedia('(pointer: coarse)').matches ? 'smooth' : 'balanced';
try { const saved = localStorage.getItem('nsm.stream.profile'); if (validProfile(saved)) quality.value = saved; } catch {}
const sendProfile = () => { if (netplay) return; const channel = peers.get(0)?.channel; if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'quality', profile: quality.value })); };
quality.onchange = () => {
  try { localStorage.setItem('nsm.stream.profile', quality.value); } catch {}
  if (player?.seat === 0) for (const entry of peers.values()) void setVideoProfile(entry, quality.value, window.EJS_emulator?.canvas);
  else sendProfile();
};
let player, stream, captureDispose, tabCapture, pollTimer, stopped = false, ack = 0, mask = 0, sequence = 0, started = false, sharing = false;
const api = async (action, data = {}) => {
  const response = await fetch(`${base}/engine/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, clientId }), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'No se pudo conectar a la partida.'); error.code = result.code; error.status = response.status; throw error; }
  return result;
};
const signal = (to, data) => api('signal', { to, data });
function drop(seat) {
  const peer = peers.get(seat);
  if (!peer) return;
  clearInterval(peer.watchdog); peer.input?.release(); peer.pc.close(); peers.delete(seat);
}
function stop() {
  stopped = true; netplay?.dispose(); clearTimeout(pollTimer);
  for (const seat of [...peers.keys()]) drop(seat);
  captureDispose?.(); tabCapture?.getTracks().forEach(track => track.stop()); stream?.getTracks().forEach(track => track.stop());
  stream = null; sharing = false;
}
function fail(error) {
  message(error.message || 'Se perdió la conexión.');
  if ([401, 403, 410].includes(error.status) || error.code === 'HOST_REPLACED') stop();
}
async function peer(seat, offer = false) {
  drop(seat);
  if (stopped || (player.seat === 0 && !stream && !netplay)) return;
  const pc = new RTCPeerConnection({ iceServers: player.iceServers });
  const entry = { pc, pending: [], channel: null, statsPrevious: undefined };
  peers.set(seat, entry);
  pc.onicecandidate = event => { if (event.candidate && !stopped) signal(seat, { type: 'ice', candidate: event.candidate.toJSON() }).catch(fail); };
  pc.onconnectionstatechange = () => {
    if (peers.get(seat) !== entry) return;
    if (player.seat > 0) $('#reconnect').hidden = !['failed', 'disconnected', 'closed'].includes(pc.connectionState);
    message(`Jugador ${seat + 1}: ${pc.connectionState === 'connected' ? 'conectado' : pc.connectionState}`);
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) entry.input?.release();
  };
  if (player.seat === 0) {
    if (netplay) {
      entry.channel = pc.createDataChannel('nsm-psx-controls-v2');
      netplay.attach(seat, entry.channel);
    } else {
    entry.input = new InputState((index, value) => window.EJS_emulator?.gameManager?.simulateInput(seat, index, value));
    for (const track of stream.getTracks()) {
      if (track.kind === 'video') track.contentHint = 'motion';
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') {
        entry.videoSender = sender;
        await setVideoProfile(entry, quality.value, window.EJS_emulator?.canvas);
      }
    }
    entry.channel = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    entry.channel.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') entry.remoteFps = data.fps;
        if (data.type === 'input') entry.input.accept(data, performance.now());
        if ((data.type === 'quality' || data.type === 'ping') && validProfile(data.profile) && data.profile !== entry.profile) void setVideoProfile(entry, data.profile, window.EJS_emulator?.canvas);
        if (data.type === 'ping' && Number.isFinite(data.at)) entry.channel.send(JSON.stringify({ type: 'pong', at: data.at, fps: entry.localFps }));
      } catch { /* Ignore malformed or obsolete input packets. */ }
    };
    entry.watchdog = setInterval(() => entry.input.expire(performance.now()), 250);
    }
  } else {
    const media = new MediaStream();
    pc.ondatachannel = event => {
      entry.channel = event.channel;
      if (netplay) {
        if (event.channel.label !== 'nsm-psx-controls-v2') {
          message('La sala usa otra versión de NSM. Recargá ambos dispositivos.');
          event.channel.close();
          return;
        }
        netplay.attach(0, event.channel);
        return;
      }
      entry.channel.onopen = sendProfile;
      if (entry.channel.readyState === 'open') sendProfile();
      entry.channel.onmessage = event => {
        try { const data = JSON.parse(event.data); if (data.type === 'pong') entry.remoteFps = data.fps; } catch { /* Not an input acknowledgement. */ }
      };
    };
    pc.ontrack = event => {
      if (!media.getTracks().some(track => track.id === event.track.id)) media.addTrack(event.track);
      let video = $('#remote-video');
      if (!video) { video = document.createElement('video'); video.id = 'remote-video'; video.autoplay = true; video.muted = true; video.playsInline = true; video.controls = false; video.disablePictureInPicture = true; $('#game').replaceChildren(video); }
      video.srcObject = media; video.play().catch(() => message('Pulsá Activar sonido para comenzar.')); $('#sound').hidden = false;
    };
  }
  preferCompatibleVideo(pc);
  if (offer) { await pc.setLocalDescription(await pc.createOffer()); await signal(seat, { type: 'offer', description: pc.localDescription.toJSON() }); }
  return entry;
}
async function receive(event) {
  if (event.type === 'joined' && player.seat === 0) { await peer(event.seat, true); return; }
  if (event.type === 'left') { drop(event.seat); netplay?.remove(event.seat); return; }
  let entry = peers.get(event.from);
  if (event.type === 'offer') {
    entry ??= await peer(event.from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(event.description);
    preferCompatibleVideo(entry.pc);
    for (const candidate of entry.pending) await entry.pc.addIceCandidate(candidate);
    entry.pending = []; await entry.pc.setLocalDescription(await entry.pc.createAnswer());
    await signal(event.from, { type: 'answer', description: entry.pc.localDescription.toJSON() });
  } else if (event.type === 'answer' && entry) {
    await entry.pc.setRemoteDescription(event.description);
    for (const candidate of entry.pending) await entry.pc.addIceCandidate(candidate);
    entry.pending = [];
  } else if (event.type === 'ice') {
    entry ??= await peer(event.from);
    if (!entry) return;
    if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(event.candidate); else entry.pending.push(event.candidate);
  }
}
let pendingPoll, signalWaiting = false;
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data !== 'nsm:signal' || !player || stopped) return;
  if (pendingPoll) signalWaiting = true;
  else { clearTimeout(pollTimer); void poll(); }
});
function poll() {
  if (!pendingPoll) pendingPoll = pollOnce().finally(() => { pendingPoll = undefined; });
  return pendingPoll;
}
async function pollOnce() {
  if (stopped || (player.seat === 0 && !sharing)) return;
  try {
    const data = await api('poll', { ack });
    if (stopped) return;
    if (!netplay && player.seat > 0 && !data.ready) message(`${player.host.displayName} está preparando el juego. Entrás sin descargar el disco.`);
    for (const event of data.events) { if (stopped) return; await receive(event); ack = event.eventId; }
  } catch (error) { fail(error); }
  if (!stopped) pollTimer = setTimeout(poll, signalWaiting ? 0 : 5000);
  signalWaiting = false;
}
async function share(useTabAudio = false) {
  if (sharing) return;
  $('#share').disabled = true;
  try {
    if (!window.EJS_emulator?.gameManager) throw new Error('Primero iniciá el juego.');
    if (useTabAudio) {
      tabCapture = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: true, preferCurrentTab: true });
      stream = new MediaStream([...window.EJS_emulator.canvas.captureStream(30).getVideoTracks(), ...tabCapture.getAudioTracks()]);
      tabCapture.getVideoTracks()[0].onended = () => { stop(); message('La captura terminó. Volvé a abrir la partida para compartir de nuevo.'); };
    } else { const captured = captureEmulator(window.EJS_emulator); stream = captured.stream; captureDispose = captured.dispose; }
    await api('ready'); sharing = true; ack = 0; clearTimeout(pollTimer); void poll();
    $('#share').hidden = true; $('#tab-share').hidden = true;
    message(stream.getAudioTracks().length ? 'Juego compartido con imagen y audio. Tus amigos pueden jugar.' : 'Juego compartido sin audio.');
  } catch (error) { captureDispose?.(); tabCapture?.getTracks().forEach(track => track.stop()); stream?.getTracks().forEach(track => track.stop()); stream = null; message(error.message); }
  finally { $('#share').disabled = false; }
}
async function awaitNetplay() {
  try {
    await api('ready');
    sharing = true;
    ack = 0;
    clearTimeout(pollTimer);
    void poll();
  } catch (error) { fail(error); }
}
let startupTimer;
$('#start').onclick = async () => {
  if (started || stopped) return;
  started = true; $('#start').disabled = true;
  let files;
  try {
    bootMessage('Verificando la instalación local…');
    const data = await manifest(player.gameId);
    const owner = player.players.find(member => member.seat === player.seat).user.id;
    files = await localFiles(owner, data);
    player.hasSbi = !!files['game.sbi'];
    installedVersion = 'nsm-psx-v2-4.2.3-legacy:' + data.assets.map(asset => asset.name + ':' + asset.sha256).join('|');
  } catch (error) {
    started = false; $('#start').disabled = false;
    bootMessage(error.message + ' Cerrá esta sala y abrí el catálogo para descargar o reanudar.');
    return;
  }
  configureGame({ base, player, files });
  const arcade = player.game.adapter === 'emulatorjs-neogeo';
  let stage = 'Preparación del emulador';
  const retryEngine = () => {
    $('#start').disabled = false;
    $('#start').textContent = 'Reintentar inicio';
    $('#start').onclick = () => location.reload();
    bootMessage(stage + ' está demorando. Podés esperar, reintentar o pedirle a un amigo que cree la sala y te invite.');
  };
  window.addEventListener('nsm:boot-error', event => {
    clearTimeout(startupTimer);
    retryEngine();
    bootMessage(event.detail + ' Reintentá o pedile a un amigo que cree la sala y te invite.');
  }, { once: true });
  startupTimer = setTimeout(retryEngine, 120000);
  const ready = window.EJS_ready;
  window.EJS_ready = () => {
    stage = 'Inicio de ' + player.game.name;
    bootMessage('Iniciando ' + player.game.name + '…');
    if (netplay) installFrameGate(window.EJS_emulator, netplay.gate);
    ready();
  };
  window.EJS_onGameStart = () => {
    clearTimeout(startupTimer);
    const manager = window.EJS_emulator?.gameManager;
    if (!arcade) manager?.functions?.setVariable('pcsx_rearmed_multitap', player.game.maxPlayers > 2 ? 'port 1' : 'disabled');
    manager?.setVSync(false);
    $('#start').hidden = true;
    if (netplay) {
      manager.functions.setVariable('pcsx_rearmed_drc', 'disabled');
      netplay.start(window.EJS_emulator, installedVersion + ':' + netplay.gate.coreHash);
      $('#save-export').hidden = player.seat !== 0;
      $('#start').hidden = true;
      $('#reconnect').hidden = player.seat === 0;
      if (player.seat === 0) {
        awaitNetplay();
      }
      $('#game').focus();
      return;
    }
    $('#save-export').hidden = false;
    $('#save-import').hidden = false;
    $('#game').focus();
    bootMessage('Juego iniciado. Conectando a tus amigos…');
    let attempts = 0;
    const connect = async () => {
      if (stopped || sharing) return;
      await share();
      if (!sharing && ++attempts < 20) setTimeout(connect, 1000);
      else if (!sharing) { $('#share').hidden = false; $('#tab-share').hidden = false; bootMessage('Abrí Controles → Conexión para reintentar compartir.'); }
    };
    void connect();
  };
  $('#game').replaceChildren(); const script = document.createElement('script'); script.src = netplay ? '/api/games/library/' + encodeURIComponent(player.gameId) + '/media/loader.js' : `${base}/media/loader.js`;
  script.onerror = () => { clearTimeout(startupTimer); retryEngine(); bootMessage('No se pudo cargar el emulador. Podés reintentar en esta sala.'); };
  document.body.append(script); bootMessage('Preparando el emulador de ' + player.game.name + '…');
};
$('#share').onclick = () => share(); $('#tab-share').onclick = () => share(true);
$('#sound').onclick = async () => { const video = $('#remote-video'); if (!video) return; video.muted = false; try { await video.play(); $('#sound').textContent = 'Sonido activado'; } catch { video.muted = true; message('Volvé a pulsar Activar sonido.'); } };
$('#reconnect').onclick = async () => {
  if (!player?.seat || stopped || $('#reconnect').disabled) return;
  $('#reconnect').disabled = true;
  try { mask = 0; transmit(); await pendingPoll; clearTimeout(pollTimer); drop(0); await api('resume'); ack = 0; void poll(); message('Reconectando tu jugador…'); }
  catch (error) { fail(error); }
  finally { if (!stopped && !pendingPoll) { clearTimeout(pollTimer); void poll(); } $('#reconnect').disabled = false; }
};
function transmit() {
  if (netplay) return;
  const channel = peers.get(0)?.channel;
  if (player?.seat > 0 && channel?.readyState === 'open' && channel.bufferedAmount < 4096) channel.send(JSON.stringify({ type: 'input', mask, sequence: sequence++ }));
}
const localInput = new InputState((index, value) => window.EJS_emulator?.gameManager?.simulateInput(0, index, value));
const controls = setupControls(next => { mask = next; if (netplay) return; if (player?.seat === 0) localInput.update(mask); else transmit(); });
let mobile;
try { mobile = setupMobilePlayer(next => controls.setTouchMask(next)); }
catch (error) { console.error('No se pudo preparar la interfaz móvil:', error); }
const inputTimer = setInterval(transmit, 50);
const pingTimer = setInterval(() => { const channel = peers.get(0)?.channel; if (!netplay && !stopped && channel?.readyState === 'open' && channel.bufferedAmount < 4096) channel.send(JSON.stringify({ type: 'ping', at: performance.now(), profile: quality.value, fps: peers.get(0)?.localFps })); }, 2000);
const heartbeat = setInterval(() => { if (player && !stopped) void api('heartbeat').catch(fail); }, 10000);
let statsBusy = false;
const statsTimer = setInterval(async () => {
  if (statsBusy || stopped) return;
  statsBusy = true;
  try {
    if (netplay) { $('#metrics').textContent = netplay.summary(); return; }
    const lines = [];
    const host = player?.seat === 0;
    const format = value => Number.isFinite(value) ? Math.round(value) + ' FPS' : 'Sin datos';
    for (const [seat, entry] of peers) {
      if (entry.pc.connectionState !== 'connected') continue;
      const report = await entry.pc.getStats();
      const type = host ? 'outbound-rtp' : 'inbound-rtp';
      const video = [...report.values()].find(item => item.kind === 'video' && item.type === type);
      const frames = host ? video?.framesSent : video?.framesDecoded;
      const old = entry.frameSample;
      entry.localFps = undefined;
      if (video && Number.isFinite(frames)) {
        if (old?.id === video.id && video.timestamp > old.time && frames >= old.frames) {
          entry.localFps = 1000 * (frames - old.frames) / (video.timestamp - old.time);
        }
        entry.frameSample = { id: video.id, frames, time: video.timestamp };
      }
      lines.push(`Jugador ${(host ? seat : player.seat) + 1} · Enviados por anfitrión: ${format(host ? entry.localFps : entry.remoteFps)} · Decodificados por invitado: ${format(host ? entry.remoteFps : entry.localFps)}`);
      if (!host) {
        const stats = summarizeStats(report, entry.statsPrevious);
        entry.statsPrevious = stats.next;
        lines.push(formatMetrics(stats.metrics));
      }
    }
    $('#metrics').textContent = lines.join('\n') || 'Sin datos';
  } catch { /* Statistics are optional. */ }
  finally { statsBusy = false; }
}, 2000);
// Memory card backups are local to the host and tagged with the game ID.
$('#save-export').onclick = () => {
  try {
    const bytes = window.EJS_emulator.gameManager.getSaveFile();
    if (!bytes?.length) return message('Primero guardá el progreso dentro del juego.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes]));
    link.download = player.gameId + '.sav';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch { message('No se pudo exportar el guardado.'); }
};
$('#save-import').onclick = () => $('#save-file').click();
$('#save-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const manager = window.EJS_emulator.gameManager;
    const current = manager.getSaveFile();
    const matchingName = file.name === player.gameId + '.sav' || file.name.startsWith(player.gameId + ' (') && file.name.endsWith(').sav');
    if (!matchingName || !current?.length || file.size !== current.length) return message('Elegí un guardado de NSM para este juego.');
    if (!confirm('¿Reemplazar la tarjeta de memoria de este juego con el guardado elegido?')) return;
    manager.FS.writeFile(manager.getSaveFilePath(), new Uint8Array(await file.arrayBuffer()));
    manager.loadSaveFiles();
    message('Guardado importado. Cargalo desde el menú del juego.');
  } catch { message('No se pudo importar el guardado.'); }
};
$('#copy-diagnostics').onclick = async () => {
  const summary = [player?.game.name, player?.seat === 0 ? 'Anfitrión' : 'Invitado', bootStatus, $('#metrics').textContent].join('\n');
  try { await navigator.clipboard.writeText(summary); $('#diagnostic-copy').textContent = 'Copiado'; }
  catch { $('#diagnostic-copy').textContent = summary; }
};
$('#diagnose').onclick = () => $('#diagnostics').showModal();
function offerReconnect() {
  if (!document.hidden && player?.seat > 0 && !stopped && peers.get(0)?.pc.connectionState !== 'connected') {
    $('#reconnect').hidden = false;
  }
}
window.addEventListener('online', offerReconnect);
document.addEventListener('visibilitychange', offerReconnect);
window.addEventListener('pageshow', event => { if (event.persisted) offerReconnect(); });
window.addEventListener('pagehide', event => { if (event.persisted) return; mobile?.dispose(); controls.dispose(); mask = 0; transmit(); stop(); for (const timer of [inputTimer, pingTimer, heartbeat, statsTimer]) clearInterval(timer); });
try {
  const response = await fetch(`${base}/player`, { cache: 'no-store', credentials: 'same-origin' });
  player = await response.json(); if (!response.ok) throw new Error(player.error || 'No tenés acceso a esta partida.');
  document.querySelector('.controls strong').textContent = player.game.name;
  document.title = player.game.name + ' · NSM';
  if (player.game.adapter === 'emulatorjs-neogeo') window.dispatchEvent(new Event('nsm:arcade-controls'));
  $('#seat').textContent = `Jugador ${player.seat + 1}`;
  if (player.game.adapter === 'emulatorjs-psx') {
    netplay = createNetplay({ host: player.seat === 0, readMask: () => mask, status: bootMessage });
    quality.closest('fieldset').hidden = true;
    $('#start').hidden = false;
  }
  $('#instructions').textContent = player.seat === 0 ? 'Este dispositivo descarga y ejecuta el juego. Mantené esta pestaña abierta. El progreso queda en este navegador.' : 'El anfitrión ejecuta el juego. En celular, usá el joystick táctil. Con teclado: WASD para mover y Enter para Start.';
  if (netplay) $('#instructions').textContent = 'Cada jugador ejecuta su copia instalada. Los controles corresponden a tu número en la sala. Mantené el juego visible para continuar juntos.';
  if (player.seat === 0) {
    await api('host-reset');
    $('#start').hidden = false;
    message('Pulsá Jugar para cargar el juego en este dispositivo.');
    {
      void fetch(`${base}/media/game.chd`, { method: 'HEAD' }).then(response => {
        const size = Number(response.headers.get('Content-Length'));
        if (response.ok && size && !started && !stopped) message(`Este dispositivo alojará ${player.game.name}. Descarga: ${Math.round(size / 1000000)} MB.`);
      }).catch(() => {});
    }
  }
  else { $('#reconnect').hidden = false; await api('resume'); message(netplay ? 'Pulsá Jugar para preparar tu copia y unirte a la partida.' : 'Esperando imagen del anfitrión…'); void poll(); }
} catch (error) { message(error.message); stop(); }
