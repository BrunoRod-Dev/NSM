const blockSize = 8 * 1024 * 1024;
const cacheName = 'nsm-library-v1';
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const key = (owner, game, asset, index) => new URL('/.nsm-library/' + [owner, asset.scope ?? game, asset.sha256, index].map(encodeURIComponent).join('/'), location.origin).href;
async function cached(cache, owner, game, asset, index) {
  const current = key(owner, game, asset, index);
  let response = await cache.match(current);
  if (!response && asset.scope && asset.scope !== game) {
    response = await cache.match(key(owner, game, { ...asset, scope: game }, index));
    if (response) {
      try { await cache.put(current, response.clone()); } catch { /* Existing game copy remains usable. */ }
    }
  }
  return response;
}
export async function manifest(game) {
  const response = await fetch('/api/games/library/' + encodeURIComponent(game), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('No se pudo consultar el juego. Revisá tu conexión o volvé a iniciar sesión.');
  return response.json();
}
export async function installed(owner, data) {
  const cache = await caches.open(cacheName);
  for (const asset of data.assets) for (let i = 0; i < asset.chunks.length; i++) {
    const response = await cached(cache, owner, data.gameId, asset, i);
    if (!response || Number(response.headers.get('Content-Length')) !== Math.min(blockSize, asset.size - i * blockSize)) return false;
  }
  return true;
}
export async function download(owner, data, report, signal) {
  let cache;
  try { cache = await caches.open(cacheName); }
  catch { throw new Error('Este navegador no permite guardar juegos. Revisá el almacenamiento y el modo privado.'); }
  const total = data.assets.reduce((n, a) => n + a.size, 0);
  let done = 0;
  for (const asset of data.assets) for (let i = 0; i < asset.chunks.length; i++) {
    signal?.throwIfAborted();
    const url = key(owner, data.gameId, asset, i);
    const start = i * blockSize, length = Math.min(blockSize, asset.size - start);
    const saved = await cached(cache, owner, data.gameId, asset, i);
    if (saved) {
      if (await digest(await saved.arrayBuffer()) === asset.chunks[i]) { done += length; report(done, total); continue; }
      await cache.delete(url);
    }
    const response = await fetch(asset.url, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { Range: 'bytes=' + start + '-' + (start + length - 1) },
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180000)]),
    });
    // Small BIOS/SBI files may be returned whole.
    if (!(response.status === 206 || start === 0 && length === asset.size && response.status === 200)) throw new Error('No se pudo continuar la descarga.');
    const reader = response.body.getReader();
    const pieces = []; let received = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        received += item.value.length;
        if (received > length) { await reader.cancel(); throw new Error('El servidor devolvió un bloque inválido.'); }
        pieces.push(item.value); report(done + received, total);
      }
    } finally { reader.releaseLock(); }
    const blob = new Blob(pieces);
    if (blob.size !== length || await digest(await blob.arrayBuffer()) !== asset.chunks[i]) throw new Error('El archivo no pasó la verificación. Reintentá la descarga.');
    try { await cache.put(url, new Response(blob, { headers: { 'Content-Length': String(length) } })); }
    catch { throw new Error('No hay espacio suficiente para guardar el juego. Liberá espacio y reintentá.'); }
    done += length; report(done, total);
  }
}
export async function localFiles(owner, data) {
  const cache = await caches.open(cacheName), files = {};
  for (const asset of data.assets) {
    const parts = [];
    for (let i = 0; i < asset.chunks.length; i++) {
      const response = await cached(cache, owner, data.gameId, asset, i);
      if (!response) throw new Error('Faltan archivos locales. Volvé al catálogo y descargá el juego.');
      const blob = await response.blob();
      if (await digest(await blob.arrayBuffer()) !== asset.chunks[i]) {
        await cache.delete(key(owner, data.gameId, asset, i));
        throw new Error('Un archivo local está dañado. Reanudá la descarga desde el catálogo.');
      }
      parts.push(blob);
    }
    files[asset.name] = new File(parts, asset.name);
  }
  return files;
}
export async function remove(owner, game) {
  const cache = await caches.open(cacheName);
  const prefix = new URL('/.nsm-library/' + [owner, game].map(encodeURIComponent).join('/') + '/', location.origin).href;
  for (const request of await cache.keys()) if (request.url.startsWith(prefix)) await cache.delete(request);
}
