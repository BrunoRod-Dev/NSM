import type { FriendsService } from '../friends/friends.service.js';

export class PresenceService {
  private connections = new Map<string, Set<string>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private friends: FriendsService, private emit: (recipient: string, event: { userId: string; online: boolean }) => void, private onError: () => void) {}
  isOnline = (userId: string) => this.connections.has(userId);
  async connected(userId: string, socketId: string) {
    const existed = this.connections.has(userId);
    const timer = this.timers.get(userId);
    if (timer) clearTimeout(timer);
    this.timers.delete(userId);
    const set = this.connections.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.connections.set(userId, set);
    if (!existed) await this.notify(userId, true);
  }
  disconnected(userId: string, socketId: string) {
    const set = this.connections.get(userId);
    set?.delete(socketId);
    if (set?.size !== 0) return;
    const timer = setTimeout(() => {
      this.timers.delete(userId);
      if (this.connections.get(userId)?.size === 0) {
        this.connections.delete(userId);
        void this.notify(userId, false).catch(this.onError);
      }
    }, 3000);
    timer.unref();
    this.timers.set(userId, timer);
  }
  private async notify(userId: string, online: boolean) {
    for (const id of await this.friends.friendIds(userId)) this.emit(id, { userId, online });
  }
  close() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.connections.clear(); }
}
