export function setupMobilePlayer(write) {
  const root = document.querySelector('#touch-controls');
  const toggle = document.querySelector('#touch-toggle');
  const fullscreen = document.querySelector('#fullscreen');
  const game = document.querySelector('#game');
  const pointers = new Map();
  const abort = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
  let expanded = false;
  let enabled = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  try { const saved = localStorage.getItem('nsm.touch.enabled'); if (saved !== null) enabled = saved === 'true'; } catch {}
  root.innerHTML = `<div class="touch-shoulders touch-left"><button data-input="12">L2</button><button data-input="10">L1</button></div>
    <div class="touch-dpad" aria-label="Cruceta de ocho direcciones"><button class="up" aria-label="Arriba">▲</button><button class="left" aria-label="Izquierda">◀</button><span></span><button class="right" aria-label="Derecha">▶</button><button class="down" aria-label="Abajo">▼</button></div>
    <div class="touch-system"><button data-input="2">SELECT</button><button data-input="3">START</button></div>
    <div class="touch-shoulders touch-right"><button data-input="11">R1</button><button data-input="13">R2</button></div>
    <div class="touch-face"><button class="triangle" data-input="9" aria-label="Triángulo">△</button><button class="square" data-input="1" aria-label="Cuadrado">□</button><button class="circle" data-input="8" aria-label="Círculo">○</button><button class="cross" data-input="0" aria-label="Cruz">×</button></div>`;
  const emit = () => { let mask = 0; for (const value of pointers.values()) mask |= value.mask; write(mask); };
  function release() { pointers.clear(); root.querySelectorAll('.held').forEach(button => button.classList.remove('held')); write(0); }
  function apply() { toggle.checked = enabled; root.hidden = !enabled; document.body.classList.toggle('touch-enabled', enabled); release(); }
  function direction(event, pad) {
    const rect = pad.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    if (Math.hypot(x, y) < .22) return 0;
    let mask = 0;
    if (x < -.38) mask |= 1 << 6; if (x > .38) mask |= 1 << 7;
    if (y < -.38) mask |= 1 << 4; if (y > .38) mask |= 1 << 5;
    return mask;
  }
  listen(root, 'pointerdown', event => {
    if (!enabled || document.querySelector('#controls-dialog').open) return;
    const pad = event.target.closest('.touch-dpad');
    const button = event.target.closest('button[data-input]');
    if (!pad && !button) return;
    event.preventDefault(); game.focus({ preventScroll: true });
    const element = pad || button;
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { element, pad, mask: pad ? direction(event, pad) : 1 << Number(button.dataset.input) });
    element.classList.add('held'); emit();
  }, { passive: false });
  listen(root, 'pointermove', event => {
    const pointer = pointers.get(event.pointerId); if (!pointer) return;
    event.preventDefault(); if (pointer.pad) { pointer.mask = direction(event, pointer.pad); emit(); }
  }, { passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(root, type, event => {
    const pointer = pointers.get(event.pointerId); if (!pointer) return;
    pointers.delete(event.pointerId);
    if (![...pointers.values()].some(value => value.element === pointer.element)) pointer.element.classList.remove('held');
    emit();
  });
  listen(root, 'contextmenu', event => event.preventDefault());
  listen(window, 'nsm:release-touch', release);
  listen(window, 'blur', release);
  listen(window, 'orientationchange', release);
  listen(document, 'visibilitychange', () => { if (document.hidden) release(); });
  listen(toggle, 'change', () => { enabled = toggle.checked; try { localStorage.setItem('nsm.touch.enabled', String(enabled)); } catch {} apply(); });
  function setExpanded(value) {
    expanded = value;
    // Keep the iframe mounted: moving it would restart the game connection.
    try { window.frameElement?.closest('nsm-games')?.classList.toggle('mobile-game-expanded', value); } catch {}
    document.body.classList.toggle('mobile-expanded', value);
    fullscreen.textContent = value || document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
    fullscreen.setAttribute('aria-pressed', String(value || !!document.fullscreenElement));
  }
  listen(fullscreen, 'click', async () => {
    release();
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    // Expanded layout also works where element fullscreen is unavailable.
    try {
      if (document.documentElement.requestFullscreen && document.fullscreenEnabled) {
        await document.documentElement.requestFullscreen();
        await screen.orientation?.lock?.('landscape').catch(() => {});
      }
    } catch { /* Keep the expanded layout and touch controls. */ }
  });
  listen(document, 'fullscreenchange', () => { if (!document.fullscreenElement) { screen.orientation?.unlock?.(); setExpanded(false); } else setExpanded(true); });
  listen(window, 'keydown', event => { if (event.key === 'Escape' && expanded && !document.fullscreenElement) setExpanded(false); });
  apply();
  return { dispose() { release(); setExpanded(false); abort.abort(); } };
}
