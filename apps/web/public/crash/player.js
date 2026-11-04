import { setupMobilePlayer } from './mobile-player.js';
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
const message = text => { $('#status').textContent = text; };
const quality = $('#stream-quality');
quality.value = isAppleMobile() || matchMedia('(pointer: coarse)').matches ? 'smooth' : 'balanced';
try { const saved = localStorage.getItem('nsm.stream.profile'); if (validProfile(saved)) quality.value = saved; } catch {}
const sendProfile = () => { const channel = peers.get(0)?.channel; if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'quality', profile: quality.value })); };
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
  stopped = true; clearTimeout(pollTimer);
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
  if (stopped || (player.seat === 0 && !stream)) return;
  const pc = new RTCPeerConnection({ iceServers: player.iceServers });
  const entry = { pc, pending: [], channel: null, statsPrevious: undefined };
  peers.set(seat, entry);
  pc.onicecandidate = event => { if (event.candidate && !stopped) signal(seat, { type: 'ice', candidate: event.candidate.toJSON() }).catch(fail); };
  pc.onconnectionstatechange = () => {
    message(`Jugador ${seat + 1}: ${pc.connectionState === 'connected' ? 'conectado' : pc.connectionState}`);
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) entry.input?.release();
  };
  if (player.seat === 0) {
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
        if (data.type === 'input') entry.input.accept(data, performance.now());
        if ((data.type === 'quality' || data.type === 'ping') && validProfile(data.profile) && data.profile !== entry.profile) void setVideoProfile(entry, data.profile, window.EJS_emulator?.canvas);
        if (data.type === 'ping' && Number.isFinite(data.at)) entry.channel.send(JSON.stringify({ type: 'pong', at: data.at }));
      } catch { /* Ignore malformed or obsolete input packets. */ }
    };
    entry.watchdog = setInterval(() => entry.input.expire(performance.now()), 250);
  } else {
    const media = new MediaStream();
    pc.ondatachannel = event => {
      entry.channel = event.channel;
      entry.channel.onopen = sendProfile;
      if (entry.channel.readyState === 'open') sendProfile();
      entry.channel.onmessage = event => {
        try { const data = JSON.parse(event.data); if (data.type === 'pong' && Number.isFinite(data.at)) $('#metrics').textContent = `Conexión de controles: ${Math.round(performance.now() - data.at)} ms ida y vuelta. No incluye el video.`; } catch { /* Not an input acknowledgement. */ }
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
  if (event.type === 'left') { drop(event.seat); return; }
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
async function poll() {
  if (stopped || (player.seat === 0 && !sharing)) return;
  try {
    const data = await api('poll', { ack });
    if (stopped) return;
    if (player.seat > 0 && !data.ready) message(`Esperando que ${player.host.displayName} inicie y comparta el juego…`);
    for (const event of data.events) { if (stopped) return; await receive(event); ack = event.eventId; }
  } catch (error) { fail(error); }
  if (!stopped) pollTimer = setTimeout(poll, 500);
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
$('#start').onclick = () => {
  if (started || stopped) return;
  started = true; $('#start').disabled = true;
  configureGame({ base, player });
  window.EJS_onGameStart = () => {
    const manager = window.EJS_emulator?.gameManager;
    manager?.functions?.setVariable('pcsx_rearmed_multitap', 'port 1'); manager?.setVSync(false);
    $('#start').hidden = true;
    $('#game').focus();
    message('Juego iniciado. Conectando a tus amigos…');
    let attempts = 0;
    const connect = async () => {
      if (stopped || sharing) return;
      await share();
      if (!sharing && ++attempts < 20) setTimeout(connect, 1000);
      else if (!sharing) { $('#share').hidden = false; $('#tab-share').hidden = false; message('Abrí Controles → Conexión para reintentar compartir.'); }
    };
    void connect();
  };
  $('#game').replaceChildren(); const script = document.createElement('script'); script.src = `${base}/media/loader.js`;
  script.onerror = () => { started = false; $('#start').disabled = false; message('No se pudo cargar el emulador. Revisá la conexión.'); };
  document.body.append(script); message('Cargando emulador y juego… La primera carga puede demorar.');
};
$('#share').onclick = () => share(); $('#tab-share').onclick = () => share(true);
$('#sound').onclick = async () => { const video = $('#remote-video'); if (!video) return; video.muted = false; try { await video.play(); $('#sound').textContent = 'Sonido activado'; } catch { video.muted = true; message('Volvé a pulsar Activar sonido.'); } };
$('#reconnect').onclick = async () => {
  if (!player?.seat || stopped) return;
  $('#reconnect').disabled = true;
  try { mask = 0; transmit(); clearTimeout(pollTimer); drop(0); await api('resume'); ack = 0; void poll(); message('Reconectando tu jugador…'); }
  catch (error) { fail(error); }
  finally { $('#reconnect').disabled = false; }
};
function transmit() {
  const channel = peers.get(0)?.channel;
  if (player?.seat > 0 && channel?.readyState === 'open' && channel.bufferedAmount < 4096) channel.send(JSON.stringify({ type: 'input', mask, sequence: sequence++ }));
}
const localInput = new InputState((index, value) => window.EJS_emulator?.gameManager?.simulateInput(0, index, value));
const controls = setupControls(next => { mask = next; if (player?.seat === 0) localInput.update(mask); else transmit(); });
let mobile;
try { mobile = setupMobilePlayer(next => controls.setTouchMask(next)); }
catch (error) { console.error('No se pudo preparar la interfaz móvil:', error); }
const inputTimer = setInterval(transmit, 50);
const pingTimer = setInterval(() => { const channel = peers.get(0)?.channel; if (!stopped && channel?.readyState === 'open' && channel.bufferedAmount < 4096) channel.send(JSON.stringify({ type: 'ping', at: performance.now(), profile: quality.value })); }, 2000);
const heartbeat = setInterval(() => { if (player && !stopped) void api('heartbeat').catch(fail); }, 10000);
let statsBusy = false;
const statsTimer = setInterval(async () => {
  const entry = peers.get(0); if (statsBusy || !entry || stopped || entry.pc.connectionState !== 'connected') return;
  statsBusy = true;
  try { const stats = summarizeStats(await entry.pc.getStats(), entry.statsPrevious); entry.statsPrevious = stats.next; $('#metrics').textContent = formatMetrics(stats.metrics); } catch { /* Statistics do not interrupt a match. */ }
  finally { statsBusy = false; }
}, 2000);
window.addEventListener('pagehide', () => { mobile?.dispose(); controls.dispose(); mask = 0; transmit(); stop(); for (const timer of [inputTimer, pingTimer, heartbeat, statsTimer]) clearInterval(timer); });
try {
  const response = await fetch(`${base}/player`, { cache: 'no-store', credentials: 'same-origin' });
  player = await response.json(); if (!response.ok) throw new Error(player.error || 'No tenés acceso a esta partida.');
  document.querySelector('.controls strong').textContent = player.game.name;
  document.title = player.game.name + ' · NSM';
  $('#seat').textContent = `Jugador ${player.seat + 1}`;
  $('#instructions').textContent = player.seat === 0 ? 'Elegí varios jugadores dentro del juego. Mantené esta pestaña abierta. Las partidas guardadas quedan en este navegador.' : 'Hacé clic en la imagen para controlar. WASD: mover. Numpad 4/8/6/2: □/△/○/×. Enter: Start. Se recomienda PC con teclado.';
  if (player.seat === 0) { await api('host-reset'); $('#start').hidden = false; message('Pulsá Jugar. Tus amigos se conectan automáticamente.'); }
  else { $('#reconnect').hidden = false; await api('resume'); message('Esperando imagen del anfitrión…'); void poll(); }
} catch (error) { message(error.message); stop(); }
