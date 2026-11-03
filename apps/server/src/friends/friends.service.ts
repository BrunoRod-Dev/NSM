import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { SocialState, User } from '../../../../packages/contracts/src/index.js';
import { usernameSchema } from '../../../../packages/contracts/src/index.js';
import { Database, lockPair, pair } from '../db.js';
import { AppError, forbidden } from '../errors.js';
import { userFromRow } from '../accounts/accounts.service.js';

export async function canContact(client: PoolClient, a: string, b: string) {
  const ids = pair(a, b);
  const result = await client.query("SELECT 1 FROM relationships r WHERE r.low_id=$1 AND r.high_id=$2 AND r.status='accepted' AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id=$1 AND target_id=$2) OR (blocker_id=$2 AND target_id=$1))", ids);
  return !!result.rowCount;
}
export class FriendsService {
  constructor(private db: Database) {}
  async friendIds(userId: string): Promise<string[]> {
    const result = await this.db.query("SELECT CASE WHEN low_id=$1 THEN high_id ELSE low_id END AS id FROM relationships r WHERE (low_id=$1 OR high_id=$1) AND status='accepted' AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=r.low_id AND b.target_id=r.high_id) OR (b.blocker_id=r.high_id AND b.target_id=r.low_id))", [userId]);
    return result.rows.map(row => row.id);
  }
  async state(user: User, isOnline: (id: string) => boolean): Promise<SocialState> {
    const result = await this.db.query("SELECT r.*,row_to_json(a) AS a,row_to_json(b) AS b FROM relationships r JOIN (SELECT id,username,display_name FROM users) a ON a.id=r.low_id JOIN (SELECT id,username,display_name FROM users) b ON b.id=r.high_id WHERE (r.low_id=$1 OR r.high_id=$1) AND status<>'removed' AND NOT EXISTS (SELECT 1 FROM blocks x WHERE (x.blocker_id=r.low_id AND x.target_id=r.high_id) OR (x.blocker_id=r.high_id AND x.target_id=r.low_id)) ORDER BY r.updated_at DESC", [user.id]);
    const state: SocialState = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const row of result.rows) {
      const a = userFromRow(row.a), b = userFromRow(row.b);
      const peer = a.id === user.id ? b : a;
      if (row.status === 'accepted') state.friends.push({ ...peer, online: isOnline(peer.id) });
      else {
        const from = row.requested_by === a.id ? a : b;
        const request = { id: row.id, from, to: from.id === a.id ? b : a };
        (from.id === user.id ? state.outgoing : state.incoming).push(request);
      }
    }
    state.blocked = (await this.db.query('SELECT u.id,u.username,u.display_name FROM blocks b JOIN users u ON u.id=b.target_id WHERE b.blocker_id=$1 ORDER BY u.username', [user.id])).rows.map(userFromRow);
    return state;
  }
  async request(user: User, input: unknown): Promise<string> {
    const username = usernameSchema.parse(input);
    const target = (await this.db.query('SELECT id FROM users WHERE username=$1', [username])).rows[0];
    if (!target || target.id === user.id) throw new AppError(400, 'No se pudo enviar la solicitud a ese usuario.');
    await this.db.transaction(async client => {
      const ids = await lockPair(client, user.id, target.id);
      if ((await client.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND target_id=$2) OR (blocker_id=$2 AND target_id=$1)', ids)).rowCount) throw new AppError(400, 'No se pudo enviar la solicitud a ese usuario.');
      const existing = await client.query('SELECT status FROM relationships WHERE low_id=$1 AND high_id=$2', ids);
      if (existing.rows[0]?.status && existing.rows[0].status !== 'removed') throw new AppError(409, 'Ya son amigos o existe una solicitud pendiente.');
      await client.query("INSERT INTO relationships(id,low_id,high_id,requested_by,status) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (low_id,high_id) DO UPDATE SET id=excluded.id,requested_by=excluded.requested_by,status='pending',updated_at=now()", [randomUUID(), ...ids, user.id]);
    });
    return target.id;
  }
  async respond(user: User, requestId: string, accept: boolean): Promise<string> {
    const found = (await this.db.query('SELECT * FROM relationships WHERE id=$1', [requestId])).rows[0];
    if (!found || ![found.low_id, found.high_id].includes(user.id) || found.requested_by === user.id) throw forbidden();
    const peerId = found.low_id === user.id ? found.high_id : found.low_id;
    await this.db.transaction(async client => {
      const ids = await lockPair(client, user.id, peerId);
      const updated = await client.query("UPDATE relationships SET status=$1,updated_at=now() WHERE id=$2 AND status='pending' RETURNING id", [accept ? 'accepted' : 'removed', requestId]);
      if (!updated.rowCount) throw new AppError(409, 'La solicitud ya no está pendiente.');
      if (accept) {
        if ((await client.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND target_id=$2) OR (blocker_id=$2 AND target_id=$1)', ids)).rowCount) throw forbidden();
        await client.query('INSERT INTO conversations(id,low_id,high_id) VALUES ($1,$2,$3) ON CONFLICT (low_id,high_id) DO NOTHING', [randomUUID(), ...ids]);
      }
    });
    return peerId;
  }
  async change(user: User, peerId: string, action: 'remove' | 'block' | 'unblock') {
    if (peerId === user.id) throw new AppError(400, 'Elegí otro usuario.');
    await this.db.transaction(async client => {
      const ids = await lockPair(client, user.id, peerId);
      if (!(await client.query('SELECT id FROM users WHERE id=$1', [peerId])).rowCount) throw new AppError(404, 'Usuario no disponible.');
      if (action === 'unblock') await client.query('DELETE FROM blocks WHERE blocker_id=$1 AND target_id=$2', [user.id, peerId]);
      else {
        await client.query("UPDATE relationships SET status='removed',updated_at=now() WHERE low_id=$1 AND high_id=$2", ids);
        if (action === 'block') await client.query('INSERT INTO blocks(blocker_id,target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, peerId]);
      }
    });
  }
}
