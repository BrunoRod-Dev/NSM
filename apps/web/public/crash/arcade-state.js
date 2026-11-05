// Compare the core payload, excluding frontend audio and metadata chunks.
export function arcadeMemory(state) {
  if (!(state instanceof Uint8Array)) throw Error('Estado arcade inválido.');
  const tag = (at, n) => new TextDecoder().decode(state.subarray(at, at + n));
  if (tag(0, 7) !== 'RASTATE') throw Error('Formato de estado arcade desconocido.');
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  for (let offset = 8; offset + 8 <= state.length;) {
    const size = view.getUint32(offset + 4, true), data = offset + 8;
    if (size > state.length - data) break;
    if (tag(offset, 4) === 'MEM ' && size) return state.subarray(data, data + size);
    offset = data + Math.ceil(size / 8) * 8;
  }
  throw Error('No se pudo verificar el estado arcade.');
}
