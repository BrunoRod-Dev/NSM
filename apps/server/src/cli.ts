import { Database } from './db.js';
import { readConfig } from './config.js';
import { AccountsService } from './accounts/accounts.service.js';

const db = new Database(readConfig().DATABASE_URL);
try {
  await db.migrate();
  if (process.argv[2] === 'migrate') console.log('Migraciones aplicadas.');
  else if (process.argv[2] === 'invite') {
    const hours = Number(process.argv[3] ?? 72);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error('El vencimiento debe ser de 1 a 720 horas.');
    const invite = await new AccountsService(db, 7).invitation(hours);
    console.log(`Invitación (se muestra una sola vez): ${invite.code}\nVence: ${invite.expiresAt}\nCompartila solamente con la persona invitada.`);
  } else throw new Error('Usá migrate o invite [horas].');
} catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo completar la operación.'); process.exitCode = 1; }
finally { await db.close(); }
