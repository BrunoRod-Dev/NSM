import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { gameDefinitions } from '../../../../packages/contracts/src/index.js';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';

export class GameCatalog {
  constructor(private config: Config) {}
  definition(id: string) {
    const game = gameDefinitions.find(game => game.id === id);
    if (!game) throw new AppError(404, 'Juego desconocido.', 'GAME_UNKNOWN');
    return game;
  }
  async list() { return Promise.all(gameDefinitions.map(async game => ({ ...game, available: game.enabled && !!await this.files(game.id) }))); }
  async files(id: string) {
    const game = this.definition(id);
    if (!game.enabled) return null;
    if (game.adapter === 'emulatorjs-neogeo') {
      const folder = this.config.NEOGEO_PROJECT_DIR;
      if (!folder) return null;
      const names: Record<string, string> = { 'metal-slug': 'mslug', 'metal-slug-2': 'mslug2', 'metal-slug-x': 'mslugx', 'metal-slug-3': 'mslug3', 'metal-slug-4': 'mslug4', 'metal-slug-5': 'mslug5' };
      const name = names[id];
      if (!name) return null;
      try {
        const gamePath = resolve(folder, name + '.zip');
        const biosPath = resolve(folder, 'neogeo.zip');
        // A ZIP's existence alone is insufficient. The audit report binds the
        // exact archives to a successful runtime verification of this core.
        const audit = JSON.parse(await readFile(resolve(folder, name + '.audit.json'), 'utf8'));
        if (audit.core !== 'emulatorjs-4.2.3-fbneo' || audit.twoPlayerVerified !== true) return null;
        const { createHash } = await import('node:crypto');
        for (const path of [gamePath, biosPath]) {
          const bytes = await readFile(path);
          if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50 || audit.sha256?.[basename(path)] !== createHash('sha256').update(bytes).digest('hex')) return null;
        }
        return { game: gamePath, bios: biosPath, loader: resolve(this.config.CRASH_PROJECT_DIR ?? '', 'runtime/loader.js'), sbi: undefined };
      } catch { return null; }
    }
    // Add a resolver for each newly supported title; configuration stays server-side.
    if (!['crash-bash', 'crash-team-racing'].includes(id)) return null;
    const dir = this.config.CRASH_PROJECT_DIR;
    if (!dir) return null;
    try {
      const rom = (await readdir(resolve(dir, 'archivos/juego'))).find(f => f.toLowerCase().endsWith('.chd'));
      const bios = (await readdir(resolve(dir, 'archivos/bios'))).find(f => f.toLowerCase().endsWith('.bin'));
      const loader = resolve(dir, 'runtime/loader.js');
      if (!rom || !bios) return null;
      const paths = { game: id === 'crash-team-racing' ? this.config.CTR_GAME_PATH : resolve(dir, 'archivos/juego', rom), bios: resolve(dir, 'archivos/bios', bios), loader, sbi: id === 'crash-team-racing' ? this.config.CTR_SBI_PATH : this.config.CRASH_SBI_PATH };
      if (!paths.game || (id === 'crash-team-racing' && !paths.sbi)) return null;
      for (const path of Object.values(paths)) if (path && !(await stat(path)).isFile()) return null;
      return { ...paths, game: paths.game };
    } catch { return null; }
  }
}
