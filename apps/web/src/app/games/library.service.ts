import { Injectable, effect, inject, signal } from '@angular/core';
import { SessionService } from '../accounts/session.service';
import { GamesService } from './games.service';
import { manifest, installed, download, remove, type LibraryManifest } from '../../../public/crash/library.js';

interface Entry { label: string; ready: boolean; busy: boolean; size: number; progress: number }
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private session = inject(SessionService);
  private games = inject(GamesService);
  readonly entries = signal<Partial<Record<string, Entry>>>({});
  readonly notice = signal('');
  private data = new Map<string, LibraryManifest>();
  private controllers = new Map<string, AbortController>();
  private owner = '';
  constructor() {
    effect(() => {
      const owner = this.session.user()?.id ?? '';
      const catalog = this.games.state().catalog;
      if (owner !== this.owner) {
        for (const controller of this.controllers.values()) controller.abort();
        this.controllers.clear(); this.data.clear(); this.entries.set({}); this.owner = owner;
      }
      for (const game of catalog) if (owner && game.available && !this.entries()[game.id]) void this.inspect(game.id, owner);
    });
  }
  private update(id: string, entry: Partial<Entry>) {
    this.entries.update(all => ({ ...all, [id]: { label: 'Consultando…', ready: false, busy: false, size: 0, progress: 0, ...all[id], ...entry } }));
  }
  async inspect(id: string, owner = this.owner) {
    this.update(id, { busy: true });
    try {
      const data = await manifest(id);
      const ready = await installed(owner, data);
      if (owner !== this.owner) return;
      this.data.set(id, data);
      this.update(id, { size: data.assets.reduce((n, a) => n + a.size, 0), ready, label: ready ? 'Instalado en este dispositivo' : 'Descarga necesaria' });
    } catch (error) {
      if (owner === this.owner) this.update(id, { label: error instanceof Error ? error.message : 'No se pudo consultar el almacenamiento.' });
    } finally { if (owner === this.owner) this.update(id, { busy: false }); }
  }
  async install(id: string) {
    if (this.controllers.has(id)) return;
    const owner = this.owner, controller = new AbortController();
    this.controllers.set(id, controller); this.update(id, { busy: true, ready: false, label: 'Preparando descarga…' });
    try {
      const data = await manifest(id);
      if (owner === this.owner) this.update(id, { size: data.assets.reduce((n, a) => n + a.size, 0) });
      await download(owner, data, (done, total) => {
        if (owner === this.owner) this.update(id, { progress: total ? Math.floor(100 * done / total) : 0, label: Math.round(done / 1000000) + ' / ' + Math.round(total / 1000000) + ' MB' });
      }, controller.signal);
      if (owner !== this.owner) return;
      this.data.set(id, data);
      this.update(id, { ready: true, progress: 100, label: 'Instalado y verificado' });
      try { await navigator.storage?.persist?.(); } catch { /* Optional browser permission. */ }
    } catch (error) {
      if (owner === this.owner) this.update(id, { label: controller.signal.aborted ? 'Pausado. Podés reanudar.' : error instanceof Error ? error.message : 'Descarga interrumpida.' });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
      if (owner === this.owner) this.update(id, { busy: false });
    }
  }
  pause(id: string) { this.controllers.get(id)?.abort(); }
  async erase(id: string) {
    if (this.entries()[id]?.busy || !confirm('¿Borrar la descarga local? Los guardados se conservan.')) return;
    try { await remove(this.owner, id); await this.inspect(id); }
    catch { this.notice.set('No se pudo borrar la descarga. Volvé a intentar.'); }
  }
  async create(id: string) {
    await this.inspect(id);
    if (this.entries()[id]?.ready) await this.games.create(id);
    else this.notice.set('Descargá el juego en este dispositivo antes de crear la sala.');
  }
}
