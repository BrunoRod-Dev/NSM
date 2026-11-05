// EmulatorJS PCSX-ReARMed 2.0.2, savestate version 0x8b410006.
// SaveState in libpcsxcore/misc.c writes a 32-byte header, version, HLE flag,
// 128*96*3 bytes of metadata, then the two MiB of PS1 main RAM.
// Compare game RAM: full savestates also contain save counters and audio timing.
export function gameMemory(state) {
  const tag = (start, count) => new TextDecoder().decode(state.subarray(start, start + count));
  if (!(state instanceof Uint8Array) || tag(0, 7) !== 'RASTATE') throw Error('Formato de estado PS1 desconocido.');
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  let offset = 8;
  while (offset + 8 <= state.length) {
    const name = tag(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (size > state.length - data) break;
    if (name === 'MEM ') {
      const start = data + 32 + 4 + 1 + 128 * 96 * 3;
      if (tag(data, 9) !== 'STv4 PCSX' || view.getUint32(data + 32, true) !== 0x8b410006 ||
          start + 0x200000 > data + size) break;
      return state.subarray(start, start + 0x200000);
    }
    offset = data + Math.ceil(size / 8) * 8;
  }
  throw Error('La versión del estado PS1 no permite verificar la sincronización.');
}
