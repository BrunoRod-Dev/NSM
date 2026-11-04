// Keep completed pieces for a retry in this room. Blob parts avoid a second
// full-sized JavaScript buffer when handing the named disc to EmulatorJS.
export function mobileDisc(url, gameId, ownerId) {
  let parts = [], offset = 0, version;
  const chunk = 16 * 1024 * 1024;
  const mb = bytes => Math.round(bytes / 1000000);
  return async function download(report) {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!head.ok) throw new Error('No se pudo acceder al disco.');
    const total = Number(head.headers.get('Content-Length'));
    const tag = head.headers.get('ETag');
    if (!total || !tag) throw new Error('No se pudo verificar el tamaño del disco.');
    if (tag !== version) { parts = []; offset = 0; version = tag; }
    // Authorize against the current room before reusing private local pieces.
    let cache;
    try { cache = await caches.open('nsm-disc-v1'); } catch { /* Private browsing can disable storage. */ }
    while (offset < total) {
      report(mb(offset), mb(total));
      const end = Math.min(offset + chunk, total) - 1;
      const key = new URL('/.nsm-disc/' + [ownerId, gameId, tag, offset].map(encodeURIComponent).join('/'), location.origin);
      const saved = await cache?.match(key).catch(() => undefined);
      const savedPart = saved && await saved.blob().catch(() => undefined);
      if (savedPart?.size === end - offset + 1) {
        parts.push(savedPart);
        offset += savedPart.size;
        continue;
      }
      const response = await fetch(url, { headers: { Range: `bytes=${offset}-${end}`, 'If-Range': tag }, cache: 'no-store', signal: AbortSignal.timeout(240000) });
      if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${offset}-${end}/${total}` || response.headers.get('ETag') !== tag) {
        await response.body?.cancel();
        throw new Error('No se pudo continuar la descarga.');
      }
      const part = await response.blob();
      if (part.size !== end - offset + 1) throw new Error('La descarga se interrumpió.');
      parts.push(part);
      offset += part.size;
      if (cache) {
        try { await cache.put(key, new Response(part)); } catch { cache = undefined; }
      }
    }
    return new File(parts, 'game.chd', { type: 'application/octet-stream' });
  };
}
