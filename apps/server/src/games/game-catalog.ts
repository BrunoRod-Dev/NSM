import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
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
