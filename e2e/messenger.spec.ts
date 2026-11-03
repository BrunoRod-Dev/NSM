import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Database } from '../apps/server/src/db.js';
import { AccountsService } from '../apps/server/src/accounts/accounts.service.js';
import { FriendsService } from '../apps/server/src/friends/friends.service.js';
import { MessagesService } from '../apps/server/src/messages/messages.service.js';

const username = () => 'e2e_' + randomUUID().replaceAll('-', '').slice(0, 10);
const password = 'Mi contraseña de prueba 2000!';
let db: Database;
let accounts: AccountsService;
test.beforeAll(() => { db = new Database(process.env['TEST_DATABASE_URL']!); accounts = new AccountsService(db, 7); });
test.afterAll(async () => { await db.close(); });

test('identidad NSM: acceso retro e icono compartido de los amigos cabeza abajo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Conexión a NSM' })).toBeVisible();
  await expect(page.locator('.auth-window .titlebar')).toHaveCSS('background-color', 'rgb(10, 36, 106)');
  await expect(page.locator('.auth-brand .messenger-mark')).toHaveCSS('background-image', /nsm-icon\.svg/);
  const icon = await page.request.get('/nsm-icon.svg');
  expect(icon.ok()).toBeTruthy();
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  await mkdir('.local/screenshots', { recursive: true });
  await page.screenshot({ path: '.local/screenshots/desktop-login.png', fullPage: true });
  await page.locator('.auth-brand .messenger-mark').screenshot({ path: '.local/screenshots/nsm-icon.png' });
});

async function register(page: Page, user: string, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Usuario', { exact: true }).fill(user);
  await page.getByLabel('Nombre visible', { exact: true }).fill(name);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Repetí la contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click();
  await expect(page.getByRole('region', { name: 'Amigos de NSM' })).toBeVisible();
  await expect(page.locator('.connection-label')).toHaveText('Conectado');
}
async function login(page: Page, user: string) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill(user);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Conectar →', exact: true }).click();
  await expect(page.locator('.connection-label')).toHaveText('Conectado');
}

test('dos sesiones: registro, amistad, chat, reconexión, ventanas, bloqueo e historial', async ({ browser }) => {
  const aContext = await browser.newContext({ viewport: { width: 1440, height: 950 } }), bContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const a = await aContext.newPage(), b = await bContext.newPage();
  const userA = username(), userB = username();
  const errors: string[] = [];
  a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
  try {
    await register(a, userA, 'Bruno');
    await register(b, userB, 'Camila');
    await a.getByLabel('Agregar un amigo').fill(userB.toUpperCase());
    await a.getByRole('button', { name: 'Agregar', exact: true }).click();
    await b.getByRole('button', { name: /^Solicitudes/ }).click();
    await b.getByRole('button', { name: `Aceptar a ${userA}`, exact: true }).click();
    await b.getByRole('button', { name: 'Amigos', exact: true }).click();
    await a.getByRole('button', { name: new RegExp(`Camila @${userB}`) }).click();
    await b.getByRole('button', { name: new RegExp(`Bruno @${userA}`) }).click();
    const aChat = a.getByRole('region', { name: 'Conversación con Camila' });
    const bChat = b.getByRole('region', { name: 'Conversación con Bruno' });
    await expect(aChat.locator('.titlebar')).toHaveCSS('background-color', 'rgb(10, 36, 106)');
    await aChat.getByLabel('Mensaje para Camila').fill('¿Estás? Volvió el chat de siempre.');
    await aChat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(bChat.getByText('¿Estás? Volvió el chat de siempre.', { exact: true })).toBeVisible();
    await bChat.getByLabel('Mensaje para Bruno').fill('¡Estoy! Qué lindo volver a conectar.');
    await bChat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(aChat.getByText('¡Estoy! Qué lindo volver a conectar.', { exact: true })).toBeVisible();
    await mkdir('.local/screenshots', { recursive: true });
    await a.screenshot({ path: '.local/screenshots/desktop-visual.png', fullPage: true });
    const literal = '<img src=x onerror="window.__nsmInjected=true">';
    await aChat.getByLabel('Mensaje para Camila').fill(literal);
    await aChat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(bChat.getByText(literal, { exact: true })).toBeVisible();
    expect(await b.evaluate(() => (window as any).__nsmInjected)).toBeUndefined();
    await expect(bChat.locator('img')).toHaveCount(0);
    // Moving, minimizing and reopening preserve the same conversation.
    const title = aChat.locator('.titlebar');
    const before = await title.boundingBox();
    await a.mouse.move(before!.x + 100, before!.y + 12); await a.mouse.down(); await a.mouse.move(before!.x + 155, before!.y + 50); await a.mouse.up();
    await expect.poll(async () => (await title.boundingBox())!.x).toBeGreaterThan(before!.x);
    await aChat.getByRole('button', { name: 'Minimizar conversación' }).click();
    await expect(aChat).toBeHidden();
    await a.locator('.chat-task').filter({ hasText: 'Camila' }).click();
    await expect(aChat.getByText('¡Estoy! Qué lindo volver a conectar.', { exact: true })).toBeVisible();
    // Closing one tab retains presence through the other tab in the same session.
    const bTab2 = await bContext.newPage();
    await bTab2.goto('/'); await expect(bTab2.locator('.connection-label')).toHaveText('Conectado');
    await bTab2.close();
    await expect(a.locator('.contact-row:not(.offline-contact)').filter({ hasText: userB })).toBeVisible();
    // Offline delivery is reconstructed from PostgreSQL after reconnecting.
    await bContext.setOffline(true);
    await expect(b.locator('.connection-label')).toContainText('Sin conexión', { timeout: 30000 });
    await aChat.getByLabel('Mensaje para Camila').fill('Te dejé un mensaje mientras estabas sin internet.');
    await aChat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await bContext.setOffline(false);
    await expect(bChat.getByText('Te dejé un mensaje mientras estabas sin internet.', { exact: true })).toBeVisible({ timeout: 30000 });
    await b.reload();
    await b.getByRole('button', { name: new RegExp(`Bruno @${userA}`) }).click();
    await expect(bChat.getByText('¿Estás? Volvió el chat de siempre.', { exact: true })).toBeVisible();
    await mkdir('.local/screenshots', { recursive: true });
    await a.screenshot({ path: '.local/screenshots/desktop-chat.png', fullPage: true });
    await bChat.getByText('Contacto', { exact: true }).click();
    b.once('dialog', dialog => dialog.accept());
    await bChat.getByRole('button', { name: 'Bloquear contacto' }).click();
    await expect(aChat.getByLabel('Mensaje para Camila')).toBeDisabled();
    await expect(bChat.getByLabel('Mensaje para Bruno')).toBeDisabled();
    await expect(bChat.getByText('¿Estás? Volvió el chat de siempre.', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});

test('usabilidad: límites de ventanas, maximizar, volver a amigos y borradores en pantallas pequeñas', async ({ page }) => {
  const create = async (displayName: string) => accounts.register({ username: username(), displayName, password, invitation: (await accounts.invitation()).code });
  const me = await create('Amigo responsive');
  const longName = 'UnAmigoConNombreLargoSinEspaciosDePrueba';
  const peers = [await create(longName), await create('Camila')];
  const friends = new FriendsService(db), messages = new MessagesService(db, accounts);
  for (const peer of peers) {
    await friends.request(me.user, peer.user.username);
    const state = await friends.state(peer.user, () => false);
    await friends.respond(peer.user, state.incoming[0].id, true);
  }
  const conversation = (await messages.list(me.user.id)).find(c => c.peer.id === peers[0].user.id)!;
  for (let i = 1; i <= 56; i++) await messages.send(peers[0].sessionToken, { conversationId: conversation.id, clientId: randomUUID(), text: `Mensaje de historial ${i}. Una conversación que podemos seguir leyendo sin perder el lugar.` });
  await page.setViewportSize({ width: 1280, height: 650 });
  await login(page, me.user.username);
  const friendsWindow = page.getByRole('region', { name: 'Amigos de NSM' });
  const open = async (index: number) => friendsWindow.getByRole('button', { name: `${peers[index].user.displayName} @${peers[index].user.username}`, exact: true }).click();
  const chat = page.getByRole('region', { name: `Conversación con ${longName}`, exact: true });
  const assertInside = async (target: import('@playwright/test').Locator) => {
    const rect = await target.boundingBox(), workspace = await page.locator('main.desktop').boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(workspace!.x);
    expect(rect!.y).toBeGreaterThanOrEqual(workspace!.y);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(workspace!.x + workspace!.width + 1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(workspace!.y + workspace!.height + 1);
  };
  await assertInside(friendsWindow);
  await open(0);
  await assertInside(chat);
  await chat.getByRole('button', { name: 'Maximizar conversación' }).click();
  await assertInside(chat);
  await expect(chat.getByRole('button', { name: 'Restaurar ventana' })).toBeVisible();
  await chat.getByRole('button', { name: 'Restaurar ventana' }).click();
  const title = await chat.locator('.titlebar').boundingBox();
  await page.mouse.move(title!.x + 100, title!.y + 10); await page.mouse.down();
  await page.mouse.move(1270, 640); await page.mouse.up();
  await assertInside(chat);
  await expect(chat.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
  const desktopRect = await chat.boundingBox();
  // Loading older messages keeps the same message at the same reading position.
  const transcript = chat.getByRole('log', { name: 'Mensajes' });
  await transcript.evaluate(el => { el.scrollTop = 0; });
  const first = transcript.locator('[data-message-id]').first();
  const anchorId = await first.getAttribute('data-message-id');
  const anchorTop = (await first.boundingBox())!.y;
  await chat.getByRole('button', { name: 'Cargar mensajes anteriores' }).click();
  await expect.poll(async () => Math.abs((await transcript.locator(`[data-message-id="${anchorId}"]`).boundingBox())!.y - anchorTop)).toBeLessThan(4);
  // A reduced height approximates the space remaining with a mobile keyboard.
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 460 }]) {
    await page.setViewportSize(viewport);
    await assertInside(chat);
    const draft = `Borrador ${viewport.width}`;
    await chat.getByLabel(`Mensaje para ${longName}`).fill(draft);
    await chat.getByLabel(`Mensaje para ${longName}`).press('Enter');
    await expect(chat.getByLabel(`Mensaje para ${longName}`)).toHaveValue(draft + '\n');
    await chat.getByRole('button', { name: 'Volver a amigos' }).click();
    await expect(chat).toBeHidden();
    await expect(friendsWindow).toBeVisible();
    await assertInside(friendsWindow);
    await open(1);
    const secondChat = page.getByRole('region', { name: 'Conversación con Camila', exact: true });
    await expect(secondChat).toBeVisible();
    await expect(page.getByRole('region', { name: /^Conversación con/ })).toHaveCount(1);
    await secondChat.getByRole('button', { name: 'Volver a amigos' }).click();
    await open(0);
    await expect(chat.getByLabel(`Mensaje para ${longName}`)).toHaveValue(draft + '\n');
    await expect(chat.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    await assertInside(chat.getByRole('button', { name: 'Enviar', exact: true }));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.local/screenshots/responsive-${viewport.width}x${viewport.height}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await chat.getByLabel(`Mensaje para ${longName}`).fill('Este borrador sigue acá al volver.');
  await page.screenshot({ path: '.local/screenshots/responsive-chat.png', fullPage: true });
  await chat.getByRole('button', { name: 'Volver a amigos' }).click();
  await page.screenshot({ path: '.local/screenshots/responsive-friends.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.locator('.main-task').click();
  await expect(friendsWindow).toBeVisible();
  await open(0);
  await assertInside(chat);
  await expect.poll(async () => Math.abs((await chat.boundingBox())!.width - desktopRect!.width)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await chat.boundingBox())!.x - desktopRect!.x)).toBeLessThan(2);
  await page.screenshot({ path: '.local/screenshots/desktop-improved.png', fullPage: true });
});

test('sesión móvil, cierre e inicio: controles accesibles y conversación dentro de pantalla', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await mkdir('.local/screenshots', { recursive: true });
    await page.screenshot({ path: '.local/screenshots/mobile-login.png', fullPage: true });
    const user = username();
    await register(page, user, 'Amigo móvil');
    const peerInvite = await accounts.invitation();
    const peer = await accounts.register({ username: username(), displayName: 'Amigo de prueba', password, invitation: peerInvite.code });
    // Exercise the friendship through authenticated HTTP, then the mobile UI.
    const request = await page.request.post('/api/friends/requests', { headers: { origin: 'http://127.0.0.1:4300' }, data: { username: peer.user.username } });
    expect(request.ok()).toBeTruthy();
    const relation = (await db.query("SELECT id FROM relationships WHERE requested_by=(SELECT id FROM users WHERE username=$1) AND status='pending'", [user])).rows[0];
    const peerCookie = `nsm.sid=${peer.sessionToken}`;
    const accepted = await page.request.post(`/api/friends/requests/${relation.id}`, { headers: { origin: 'http://127.0.0.1:4300', cookie: peerCookie }, data: { accept: true } });
    expect(accepted.ok()).toBeTruthy();
    // APIRequestContext shares the cookie jar: restore the mobile user's session explicitly.
    await context.clearCookies();
    await page.reload();
    await login(page, user);
    await page.getByRole('button', { name: new RegExp(`Amigo de prueba @${peer.user.username}`) }).click();
    const chat = page.getByRole('region', { name: 'Conversación con Amigo de prueba' });
    const box = await chat.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 39);
    await chat.getByLabel('Mensaje para Amigo de prueba').fill('Hola desde el celular.');
    await chat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(chat.locator('.message:not(.pending-message)').getByText('Hola desde el celular.', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.local/screenshots/mobile-chat.png', fullPage: true });
    await chat.getByRole('button', { name: 'Cerrar conversación' }).click();
    await page.getByRole('button', { name: 'Salir', exact: true }).click();
    await expect(page.getByLabel('Usuario', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});


test('registro: errores claros, confirmación y mostrar contraseña sin códigos', async ({page}) => {
 await page.goto('/');await page.getByRole('button',{name:'Crear cuenta',exact:true}).click();
 await expect(page.getByLabel('Invitación',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Crear mi cuenta'}).click();
 await expect(page.getByText('Ingresá tu usuario.',{exact:true})).toBeVisible();
 await page.getByLabel('Usuario',{exact:true}).fill(username());
 await page.getByLabel('Nombre visible',{exact:true}).fill('Cuenta nueva');
 await page.getByLabel('Contraseña',{exact:true}).fill(password);
 await page.getByLabel('Repetí la contraseña',{exact:true}).fill('otra clave');
 await page.getByLabel('Mostrar contraseñas',{exact:true}).check();
 await expect(page.locator('#password')).toHaveAttribute('type','text');
 await expect(page.locator('#password')).toHaveAttribute('autocomplete','new-password');
 await page.getByRole('button',{name:'Crear mi cuenta'}).click();
 await expect(page.getByText('Las contraseñas no coinciden.',{exact:true})).toBeVisible();
 await page.getByLabel('Repetí la contraseña',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Crear mi cuenta'}).click();
 await expect(page.getByRole('region',{name:'Amigos de NSM'})).toBeVisible();
});
