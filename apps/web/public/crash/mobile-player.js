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
    <div class="touch-dpad" role="group" aria-label="Joystick táctil de ocho direcciones"><span class="stick-ring"></span><span class="stick-knob"></span></div>
    <div class="touch-system"><button data-input="2">SELECT</button><button data-input="3">START</button></div>
    <div class="touch-shoulders touch-right"><button data-input="11">R1</button><button data-input="13">R2</button></div>
    <div class="touch-face"><button class="triangle" data-input="9" aria-label="Triángulo">△</button><button class="square" data-input="1" aria-label="Cuadrado">□</button><button class="circle" data-input="8" aria-label="Círculo">○</button><button class="cross" data-input="0" aria-label="Cruz">×</button></div>`;
  window.addEventListener('nsm:arcade-controls', () => {
    root.classList.add('arcade-touch');
    root.querySelectorAll('.touch-shoulders').forEach(node => node.hidden = true);
    for (const [input, label] of [[0, 'Disparo'], [8, 'Salto'], [1, 'Granada'], [9, 'Acción'], [2, 'Ficha']]) {
      const button = root.querySelector('button[data-input="' + input + '"]');
      button.textContent = label;
      button.setAttribute('aria-label', label);
    }
  }, { signal: abort.signal });
  const emit = () => { let mask = 0; for (const value of pointers.values()) mask |= value.mask; write(mask); };
  function release() { root.querySelector('.stick-knob').style.transform = 'translate(-50%, -50%)'; pointers.clear(); root.querySelectorAll('.held').forEach(button => button.classList.remove('held')); write(0); }
  function apply() { toggle.checked = enabled; root.hidden = !enabled; document.body.classList.toggle('touch-enabled', enabled); release(); }
  function direction(event, pad) {
    const rect = pad.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    const distance = Math.hypot(x, y);
    const scale = Math.min(distance, 1) / (distance || 1);
    pad.querySelector('.stick-knob').style.transform = `translate(calc(-50% + ${x * scale * rect.width * .28}px), calc(-50% + ${y * scale * rect.height * .28}px))`;
    if (distance < .22) return 0;
    let mask = 0;
    if (x < -.38) mask |= 1 << 6; if (x > .38) mask |= 1 << 7;
    if (y < -.38) mask |= 1 << 4; if (y > .38) mask |= 1 << 5;
    return mask;
  }
  listen(root, 'pointerdown', event => {
    if (event.pointerType === 'touch' || !enabled || document.querySelector('#controls-dialog').open) return;
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
  // Track actual touch identifiers independently. Safari may cancel pointer
  // captures when a second finger starts a gesture; do not mix both streams.
  function paintTouches() {
    root.querySelectorAll('.held').forEach(element => element.classList.remove('held'));
    for (const pointer of pointers.values()) pointer.element.classList.add('held');
    if (![...pointers.values()].some(pointer => pointer.pad)) root.querySelector('.stick-knob').style.transform = 'translate(-50%, -50%)';
    emit();
  }
  listen(root, 'touchstart', event => {
    if (!enabled || document.querySelector('#controls-dialog').open) return;
    event.preventDefault();
    if (!pointers.size) game.focus({ preventScroll: true });
    for (const touch of event.changedTouches) {
      const pad = touch.target.closest?.('.touch-dpad');
      const button = touch.target.closest?.('button[data-input]');
      if (!pad && !button) continue;
      pointers.set('touch-' + touch.identifier, {
        element: pad || button, pad,
        mask: pad ? direction(touch, pad) : 1 << Number(button.dataset.input),
      });
    }
    paintTouches();
  }, { passive: false });
  listen(root, 'touchmove', event => {
    if (!pointers.size) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const pointer = pointers.get('touch-' + touch.identifier);
      if (pointer?.pad) pointer.mask = direction(touch, pointer.pad);
    }
    paintTouches();
  }, { passive: false });
  for (const type of ['touchend', 'touchcancel']) listen(window, type, event => {
    let changed = false;
    for (const touch of event.changedTouches) changed = pointers.delete('touch-' + touch.identifier) || changed;
    if (changed) { if (event.cancelable) event.preventDefault(); paintTouches(); }
  }, { passive: false });
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
  const exit = document.createElement('button');
  exit.className = 'mobile-game-exit'; exit.type = 'button';
  exit.textContent = '↙'; exit.setAttribute('aria-label', 'Salir de pantalla completa');
  document.body.append(exit);
  listen(exit, 'click', () => fullscreen.click());
  apply();
  return { dispose() { release(); setExpanded(false); exit.remove(); abort.abort(); } };
}
