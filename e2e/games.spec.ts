import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Database } from '../apps/server/src/db.js';
import { AccountsService } from '../apps/server/src/accounts/accounts.service.js';
import { FriendsService } from '../apps/server/src/friends/friends.service.js';

const password = 'NSM game integration test 2000!';
test('invitación desde chat y panel de salas, WebRTC generado, controles, reconexión y fin de partida', async ({ browser }) => {
  const db = new Database(process.env['TEST_DATABASE_URL']!);
  const accounts = new AccountsService(db, 7), friends = new FriendsService(db);
  const hostUsername = 'e2e_game_host';
  const existing = (await db.query('SELECT id FROM users WHERE username=$1', [hostUsername])).rows[0];
  const host = existing ? await accounts.login({ username: hostUsername, password }) : await accounts.register({ username: hostUsername, displayName: 'Admin de prueba', password, invitation: (await accounts.invitation()).code });
  const guest = await accounts.register({ username: 'guest_' + randomUUID().slice(0, 8), displayName: 'Amigo invitado', password, invitation: (await accounts.invitation()).code });
  await friends.request(host.user, guest.user.username);
  await friends.respond(guest.user, (await friends.state(guest.user, () => false)).incoming[0].id, true);
  const hostContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const a = await hostContext.newPage(), b = await guestContext.newPage();
  const login = async (page: Page, username: string) => {
    await page.goto('/'); await page.getByLabel('Usuario', { exact: true }).fill(username); await page.getByLabel('Contraseña', { exact: true }).fill(password); await page.getByRole('button', { name: 'Conectar →', exact: true }).click(); await expect(page.locator('.connection-label')).toHaveText('Conectado');
  };
  try {
    await login(a, hostUsername); await login(b, guest.user.username);
    await a.getByRole('button', { name: 'Juegos', exact:true }).click();
    await a.getByRole('button', { name: 'Crear sala de Crash Bash', exact:true }).click();
    await a.locator(`[data-friend-id="${guest.user.id}"]`).getByRole('button', {name:'Invitar a la sala',exact:true}).click();
    await expect(a.getByRole('region', { name: 'Juegos de NSM' })).toBeVisible();
    await b.getByRole('button', { name: 'Ver invitaciones', exact: true }).click();
    await b.getByRole('button', { name: 'Aceptar partida de Admin de prueba', exact: true }).click();
    const hostFrame = a.frameLocator('iframe[title="Partida de Crash Bash"]');
    const guestFrame = b.frameLocator('iframe[title="Partida de Crash Bash"]');
    await expect(hostFrame.locator('#seat')).toHaveText('Jugador 1');
    await expect(guestFrame.locator('#seat')).toHaveText('Jugador 2');
    // EmulatorJS loads its runtime and WASM from in-memory URLs, even when the outer scripts came from the CDN.
    const runtimeFrame = a.frames().find(frame => frame.url().includes('/view'))!;
    const wasmSize = await runtimeFrame.evaluate(async () => {
      const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
      const url = URL.createObjectURL(new Blob([binary], { type: 'application/wasm' }));
      try { const bytes = await (await fetch(url)).arrayBuffer(); await WebAssembly.compile(bytes); return bytes.byteLength; }
      finally { URL.revokeObjectURL(url); }
    });
    expect(wasmSize).toBe(8);
    await hostFrame.getByRole('button', { name: 'Jugar', exact: true }).click();

    const video = guestFrame.locator('#remote-video');
    await expect(video).toBeVisible({ timeout: 30000 });
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(2);
    await expect(video).not.toHaveAttribute('controls');
    // The media is real WebRTC; the fixture deliberately generates canvas/audio instead of emulating Crash Bash.
    await guestFrame.locator('#game').click();
    await b.keyboard.down('w'); await b.keyboard.up('w');
    const hostRuntime = a.frames().find(frame => frame.url().includes('/view'))!;
    await expect.poll(() => hostRuntime.evaluate(() => (window as any).__nsmTestInputs?.some((input: any) => input.seat === 1 && input.index === 4 && input.value === 1))).toBeTruthy();
    await expect.poll(() => hostRuntime.evaluate(() => (window as any).__nsmTestInputs?.some((input: any) => input.seat === 1 && input.index === 4 && input.value === 0))).toBeTruthy();
    await guestFrame.getByRole('button', { name: 'Controles', exact: true }).click();
    await guestFrame.locator('summary').click();
    // A standard Bluetooth-style gamepad on the guest must drive seat 2, never seat 1.
    const guestRuntime = b.frames().find(frame => frame.url().includes('/view'))!;
    await guestRuntime.evaluate(() => {
      (window as any).__pad = { index: 0, id: 'Xbox test (standard)', mapping: 'standard', axes: [0,0], buttons: Array.from({length:17}, () => ({pressed:false,value:0})) };
      Object.defineProperty(navigator, 'getGamepads', { configurable:true, value: () => [(window as any).__pad] });
    });
    await expect(guestFrame.locator('#device option')).toHaveCount(2);
    await guestFrame.locator('#device').selectOption('0');
    await guestFrame.getByRole('button', { name: 'Cerrar controles' }).click();
    await guestFrame.locator('#game').click();
    await guestRuntime.evaluate(() => { (window as any).__pad.buttons[0] = {pressed:true,value:1}; });
    await expect.poll(() => hostRuntime.evaluate(() => (window as any).__nsmTestInputs?.some((input:any) => input.seat===1 && input.index===0 && input.value===1))).toBeTruthy();
    await guestRuntime.evaluate(() => { (window as any).__pad.buttons[0] = {pressed:false,value:0}; });
    await expect.poll(() => hostRuntime.evaluate(() => (window as any).__nsmTestInputs?.some((input:any) => input.seat===1 && input.index===0 && input.value===0))).toBeTruthy();
    await guestFrame.getByRole('button', { name: 'Controles', exact: true }).click();
    await guestFrame.getByRole('button', { name: 'Reconectar jugador' }).click();
    await guestFrame.getByRole('button', { name: 'Cerrar controles' }).click();
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(2);
    await a.getByRole('button', { name: 'Amigos y chat', exact: true }).click();
    await a.getByRole('button', { name: `Amigo invitado @${guest.user.username}`, exact: true }).click();
    const chat = a.getByRole('region', { name: 'Conversación con Amigo invitado' });
    await chat.getByLabel('Mensaje para Amigo invitado').fill('¿Listo para la próxima ronda?');
    await chat.getByRole('button', { name: 'Enviar', exact: true }).click();
    await a.locator('.game-task').click();
    await expect(hostFrame.locator('#game canvas')).toBeVisible();
    await mkdir('.local/screenshots', { recursive: true });
    await a.screenshot({ path: '.local/screenshots/game-integration-generated.png', fullPage: true });
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: 'Terminar partida', exact: true }).click();
    await expect(a.locator('iframe[title="Partida de Crash Bash"]')).toHaveCount(0);
    await expect(b.locator('iframe[title="Partida de Crash Bash"]')).toHaveCount(0);
  } finally { await hostContext.close(); await guestContext.close(); await db.close(); }
});
