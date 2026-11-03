import { randomUUID } from 'node:crypto';
import type { Conversation, Message, MessagePage } from '../../../../packages/contracts/src/index.js';
import { messageInputSchema } from '../../../../packages/contracts/src/index.js';
import { Database, lockPair } from '../db.js';
import { forbidden, AppError } from '../errors.js';
import { AccountsService, userFromRow } from '../accounts/accounts.service.js';
import { canContact } from '../friends/friends.service.js';

const messageFromRow = (r: Record<string, any>): Message => ({ id: r.id, conversationId: r.conversation_id, seq: r.seq, senderId: r.sender_id, clientId: r.client_id, text: r.body, createdAt: r.created_at.toISOString() });
export class MessagesService {
  constructor(private db: Database, private accounts: AccountsService) {}
  async list(userId: string): Promise<Conversation[]> {
    const result = await this.db.query("SELECT c.*,u.username,u.display_name,u.id AS peer_id,(r.status='accepted' AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=c.low_id AND b.target_id=c.high_id) OR (b.blocker_id=c.high_id AND b.target_id=c.low_id))) AS can_send FROM conversations c JOIN users u ON u.id=CASE WHEN c.low_id=$1 THEN c.high_id ELSE c.low_id END LEFT JOIN relationships r ON r.low_id=c.low_id AND r.high_id=c.high_id WHERE c.low_id=$1 OR c.high_id=$1 ORDER BY c.latest_seq DESC,u.username", [userId]);
    return result.rows.map(row => ({ id: row.id, peer: userFromRow({ ...row, id: row.peer_id }), canSend: row.can_send === true, latestSeq: row.latest_seq }));
  }
  async history(userId: string, conversationId: string, options: { before?: number; after?: number; limit: number }): Promise<MessagePage> {
    if (!(await this.db.query('SELECT id FROM conversations WHERE id=$1 AND (low_id=$2 OR high_id=$2)', [conversationId, userId])).rowCount) throw forbidden();
    const after = options.after !== undefined;
    const bound = after ? options.after! : options.before ?? 2147483647;
    const result = await this.db.query(`SELECT * FROM messages WHERE conversation_id=$1 AND seq ${after ? '>' : '<'} $2 ORDER BY seq ${after ? 'ASC' : 'DESC'} LIMIT $3`, [conversationId, bound, options.limit + 1]);
    const messages = result.rows.slice(0, options.limit).map(messageFromRow);
    if (!after) messages.reverse();
    return { messages, hasMore: result.rows.length > options.limit };
  }
  async send(sessionToken: string, input: unknown): Promise<{ message: Message; recipients: string[] }> {
    const data = messageInputSchema.parse(input);
    return this.db.transaction(async client => {
      const identity = await this.accounts.identity(sessionToken, client);
      const result = await client.query('SELECT * FROM conversations WHERE id=$1 AND (low_id=$2 OR high_id=$2)', [data.conversationId, identity.user.id]);
      const conversation = result.rows[0];
      if (!conversation) throw forbidden();
      await lockPair(client, conversation.low_id, conversation.high_id);
      if (!await canContact(client, conversation.low_id, conversation.high_id)) throw new AppError(403, 'Solo podés escribir a amigos aceptados que no estén bloqueados.', 'CONTACT_REQUIRED');
      const existing = await client.query('SELECT * FROM messages WHERE sender_id=$1 AND client_id=$2', [identity.user.id, data.clientId]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.conversation_id !== data.conversationId || row.body !== data.text) throw new AppError(409, 'Este identificador ya corresponde a otro mensaje.', 'IDEMPOTENCY_CONFLICT');
        return { message: messageFromRow(row), recipients: [conversation.low_id, conversation.high_id] };
      }
      const seq = (await client.query('UPDATE conversations SET latest_seq=latest_seq+1 WHERE id=$1 RETURNING latest_seq', [data.conversationId])).rows[0].latest_seq;
      const inserted = await client.query('INSERT INTO messages(id,conversation_id,seq,sender_id,client_id,body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), data.conversationId, seq, identity.user.id, data.clientId, data.text]);
      return { message: messageFromRow(inserted.rows[0]), recipients: [conversation.low_id, conversation.high_id] };
    });
  }
}
