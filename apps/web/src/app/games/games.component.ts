import { Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { LibraryService } from './library.service';
import { GamesService } from './games.service';
import { MessengerService } from '../messenger/messenger.service';
import { SessionService } from '../accounts/session.service';

@Component({ selector: 'nsm-games', templateUrl: './games.component.html' })
export class GamesComponent {
  readonly library = inject(LibraryService);
  readonly games = inject(GamesService);
  readonly messenger = inject(MessengerService);
  readonly consoles = [
    { id: 'ps1', name: 'PlayStation 1', help: 'La BIOS de PlayStation se instala con el primer juego y se comparte entre títulos compatibles.' },
    { id: 'neogeo', name: 'Neo Geo · Arcade', help: 'BIOS y juegos arcade se validan por separado antes de habilitarlos.' },
  ];
  consoleGames(id: string) { return this.games.state().catalog.filter(game => game.enabled && game.console === id); }
  readonly inviteable = computed(() => {
    const room=this.games.activeRoom();
    return this.messenger.social().friends.filter(friend => !room?.players.some(p=>p.user.id===friend.id));
  });
  pending(id:string) { return this.games.state().outgoing.some(i=>i.roomId===this.games.activeId() && i.to.id===id); }
  full() { const room=this.games.activeRoom();return !!room && room.players.length+this.games.state().outgoing.filter(i=>i.roomId===room.id).length>=room.game.maxPlayers; }
  readonly session = inject(SessionService);
  private sanitizer = inject(DomSanitizer);
  readonly focused = input(false);
  readonly focusWindow = output<void>();
  readonly showFriends = output<void>();
  readonly frame = computed(() => { const id = this.games.activeId(); return id && /^[0-9a-f-]{36}$/.test(id) ? this.sanitizer.bypassSecurityTrustResourceUrl(`/api/games/rooms/${id}/view`) : null; });
  async leave(close = false) {
    const room = this.games.activeRoom();
    if (room && !confirm(room.host.id === this.session.user()?.id ? '¿Terminar la partida para todos? Los guardados del emulador permanecen en tu navegador.' : '¿Salir de la partida?')) return;
    if (await this.games.leave() && close) { this.games.visible.set(false); this.showFriends.emit(); }
  }
}
