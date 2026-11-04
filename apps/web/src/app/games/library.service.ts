import { Injectable, effect, inject, signal } from '@angular/core';
import { SessionService } from '../accounts/session.service';
import { GamesService } from './games.service';
import { manifest, installed, download, remove } from '../../../public/crash/library.js';

interface Entry { label: string; ready: boolean; busy: boolean; downloading: boolean; size: number; progress: number }
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private session = inject(SessionService);
  private games = inject(GamesService);
  readonly entries = signal<Partial<Record<string, Entry>>>({});
  readonly notice = signal('');
  private controllers = new Map<string, AbortController>();
  private owner = '';
  constructor() {
    effect(() => {
      const owner = this.session.user()?.id ?? '';
      const catalog = this.games.state().catalog;
      if (owner !== this.owner) {
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear(); this.notice.set(''); this.entries.set({}); this.owner = owner;
      }
      for (const game of catalog) if (owner && game.available && !this.entries()[game.id]) void this.inspect(game.id, owner);
    });
  }
  private update(id: string, entry: Partial<Entry>) {
    this.entries.update(all => ({ ...all, [id]: { label: 'Consultando…', ready: false, busy: false, downloading: false, size: 0, progress: 0, ...all[id], ...entry } }));
  }
  async inspect(id: string, owner = this.owner) {
    this.update(id, { busy: true });
    try {
      const data = await manifest(id);
      const ready = await installed(owner, data);
      if (owner !== this.owner) return;
      this.update(id, { size: data.assets.reduce((n, a) => n + a.size, 0), ready, label: ready ? 'Instalado en este dispositivo' : 'Descarga necesaria' });
    } catch (error) {
      if (owner === this.owner) this.update(id, { label: error instanceof Error ? error.message : 'No se pudo consultar el almacenamiento.' });
    } finally { if (owner === this.owner) this.update(id, { busy: false }); }
  }
  async install(id: string) {
    if (this.controllers.has(id)) return;
    const owner = this.owner, controller = new AbortController();
    this.controllers.set(id, controller); this.update(id, { busy: true, downloading: true, progress: 0, ready: false, label: 'Preparando descarga…' });
    try {
      const data = await manifest(id);
      if (owner === this.owner) this.update(id, { size: data.assets.reduce((n, a) => n + a.size, 0) });
      let lastUpdate = -Infinity;
      await download(owner, data, (done, total) => {
        const now = performance.now();
        if (done < total && now - lastUpdate < 200) return;
        lastUpdate = now;
        if (owner === this.owner) this.update(id, { progress: total ? Math.floor(100 * done / total) : 0, label: Math.round(done / 1000000) + ' / ' + Math.round(total / 1000000) + ' MB' });
      }, controller.signal);
      if (owner !== this.owner) return;
      this.update(id, { ready: true, progress: 100, label: 'Instalado y verificado' });
      try { await navigator.storage?.persist?.(); } catch { /* Optional browser permission. */ }
    } catch (error) {
      if (owner === this.owner) this.update(id, { label: controller.signal.aborted ? 'Pausado. Podés reanudar.' : error instanceof Error ? error.message : 'Descarga interrumpida.' });
    } finally {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id);
        this.update(id, { busy: false, downloading: false });
      }
    }
  }
  pause(id: string) { this.controllers.get(id)?.abort(); }
  async erase(id: string) {
    if (this.entries()[id]?.busy || !confirm('¿Borrar la descarga local? Los guardados se conservan.')) return;
    const owner = this.owner;
    this.update(id, { busy: true, label: 'Borrando descarga…' });
    try { await remove(owner, id); }
    catch { if (owner === this.owner) this.notice.set('No se pudo borrar la descarga. Volvé a intentar.'); }
    finally { if (owner === this.owner) await this.inspect(id, owner); }
  }
  async create(id: string) {
    const owner = this.owner;
    await this.games.create(id);
    if (owner === this.owner && this.games.error()) await this.inspect(id, owner);
  }
}
