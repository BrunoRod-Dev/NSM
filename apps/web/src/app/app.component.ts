import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal, untracked, HostListener, type AfterViewInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthComponent } from './accounts/auth.component';
import { SessionService } from './accounts/session.service';
import { MessengerService } from './messenger/messenger.service';
import { FriendsComponent } from './friends/friends.component';
import { ChatComponent } from './messenger/chat.component';
import { availableRect, COMPACT_WIDTH, fitWindow, type WindowRect, type WorkspaceSize } from './core/window-layout';
import { GamesComponent } from './games/games.component';
import { GamesService } from './games/games.service';

interface ChatWindow extends WindowRect { id: string; z: number; minimized: boolean; maximized: boolean; restoreRect?: WindowRect; desktopRect?: WindowRect }
@Component({ selector: 'nsm-root', imports: [AuthComponent, FriendsComponent, ChatComponent, GamesComponent, DatePipe], templateUrl: './app.component.html' })
export class AppComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('workspace') private workspace?: ElementRef<HTMLElement>;
  readonly session = inject(SessionService);
  readonly store = inject(MessengerService);
  readonly games = inject(GamesService);
  readonly gamesZ = signal(4);
  readonly gamesForeground = signal(false);
  readonly windows = signal<ChatWindow[]>([]);
  readonly active = signal<string | null>(null);
  readonly startOpen = signal(false);
  readonly now = signal(new Date());
  readonly compact = signal(innerWidth <= COMPACT_WIDTH);
  readonly viewportHeight = signal(window.visualViewport?.height ?? innerHeight);
  readonly friendsForeground = signal(true);
  readonly friendsZ = signal(3);
  readonly taskWindows = computed(() => this.compact() ? this.windows().filter(w => w.id === this.active()) : this.windows());
  private z = 10;
  constructor() {
    let lastUser: string | null = null;
    effect(() => {
      const id = this.session.user()?.id ?? null;
      untracked(() => {
        if (id === lastUser) return;
        lastUser = id; this.windows.set([]); this.active.set(null); this.friendsForeground.set(true);
        if (id) { this.store.start(); this.games.start(); } else { this.store.stop(); this.games.stop(); }
      });
    });
    effect(() => { const request = this.games.openRequest(); if (request) untracked(() => this.focusGames()); });
    void this.session.restore();
    const clock = setInterval(() => this.now.set(new Date()), 30000);
    this.destroyRef.onDestroy(() => clearInterval(clock));
  }
  ngAfterViewInit() {
    const update = () => {
      this.viewportHeight.set(window.visualViewport?.height ?? innerHeight);
      this.compact.set(innerWidth <= COMPACT_WIDTH);
      requestAnimationFrame(() => this.fitWindows());
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    });
    update();
  }
  private workspaceSize(): WorkspaceSize {
    return { width: this.workspace?.nativeElement.clientWidth ?? innerWidth, height: this.workspace?.nativeElement.clientHeight ?? this.viewportHeight() - 44 };
  }
  private fitWindows() {
    const bounds = this.workspaceSize();
    this.windows.update(all => all.map(w => bounds.width <= COMPACT_WIDTH
      ? { ...w, ...availableRect(bounds), desktopRect: w.desktopRect ?? { x: w.x, y: w.y, width: w.width, height: w.height } }
      : { ...w, ...(w.maximized ? availableRect(bounds) : fitWindow(w.desktopRect ?? w, bounds)), desktopRect: undefined }));
  }
  conversation(id: string) { return this.store.conversations().find(c => c.id === id); }
  openPeer(peerId: string) {
    const conversation = this.store.conversations().find(c => c.peer.id === peerId);
    if (!conversation) { void this.store.refresh(); return; }
    if (!this.windows().some(w => w.id === conversation.id)) {
      const n = this.windows().length % 5;
      const desktopRect = { x: 470 + n * 26, y: 64 + n * 26, width: 500, height: 590 };
      const rect = fitWindow(desktopRect, this.workspaceSize());
      this.windows.update(all => [...all, { id: conversation.id, ...rect, z: ++this.z, minimized: false, maximized: false, desktopRect: this.compact() ? desktopRect : undefined }]);
    }
    this.focus(conversation.id, true);
    void this.store.load(conversation.id);
  }
  focus(id: string, focusComposer = false) {
    this.gamesForeground.set(false);
    this.windows.update(all => all.map(w => w.id === id ? { ...w, minimized: false, z: ++this.z } : w));
    this.active.set(id); this.store.activeConversation = id;
    this.friendsForeground.set(false); this.startOpen.set(false);
    this.store.unread.update(all => ({ ...all, [id]: 0 }));
    if (focusComposer && !this.compact()) requestAnimationFrame(() => this.workspace?.nativeElement.querySelector<HTMLTextAreaElement>(`nsm-chat[data-window-id="${id}"] textarea:not(:disabled)`)?.focus({ preventScroll: true }));
  }
  showFriends(focusList = true) {
    this.gamesForeground.set(false);
    this.friendsForeground.set(true); this.friendsZ.set(++this.z);
    this.active.set(null); this.store.activeConversation = null; this.startOpen.set(false);
    if (focusList) requestAnimationFrame(() => this.workspace?.nativeElement.querySelector<HTMLButtonElement>('nsm-friends .tabs button.selected')?.focus({ preventScroll: true }));
  }
  focusGames() {
    this.gamesZ.set(++this.z); this.gamesForeground.set(true);
    this.friendsForeground.set(false); this.active.set(null); this.store.activeConversation = null; this.startOpen.set(false);
  }
  minimize(id: string) { this.windows.update(all => all.map(w => w.id === id ? { ...w, minimized: true } : w)); this.clearFocus(id); }
  close(id: string) { this.windows.update(all => all.filter(w => w.id !== id)); this.clearFocus(id); }
  private clearFocus(id: string) { if (this.active() === id) this.showFriends(); }
  move(id: string, delta: { dx: number; dy: number }) {
    if (this.compact()) return;
    this.windows.update(all => all.map(w => w.id === id && !w.maximized ? { ...w, ...fitWindow({ ...w, x: w.x + delta.dx, y: w.y + delta.dy }, this.workspaceSize()) } : w));
  }
  toggleMaximize(id: string) {
    if (this.compact()) return;
    this.windows.update(all => all.map(w => w.id !== id ? w : w.maximized
      ? { ...w, ...fitWindow(w.restoreRect ?? { x: 470, y: 64, width: 500, height: 590 }, this.workspaceSize()), maximized: false, restoreRect: undefined }
      : { ...w, ...availableRect(this.workspaceSize()), maximized: true, restoreRect: { x: w.x, y: w.y, width: w.width, height: w.height } }));
    this.focus(id);
  }
  @HostListener('document:keydown.escape') dismissMenus() {
    this.startOpen.set(false);
    this.workspace?.nativeElement.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(details => { details.open = false; });
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (Object.values(this.store.pending()).some(messages => messages?.length)) event.preventDefault();
  }
}
