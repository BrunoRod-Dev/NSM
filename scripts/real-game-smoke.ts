import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createApp } from '../apps/server/src/app.js';
import { readConfig } from '../apps/server/src/config.js';
import { prepareTestDatabase } from '../apps/server/test/database.js';

// Explicit local smoke test using the owner's existing game files. No ROM is copied.
const origin = 'http://127.0.0.1:4302';
const username = 'real_' + randomUUID().slice(0, 8);
const config = { ...readConfig(), DATABASE_URL: await prepareTestDatabase(), PORT: 4302, APP_ORIGIN: origin, NODE_ENV: 'test' as const, CRASH_HOST_USERNAME: username };
const server = await createApp(config);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
let progress: ReturnType<typeof setInterval> | undefined;
try {
  if (!await server.games.files()) throw new Error('Configurá CRASH_PROJECT_DIR con los archivos locales del juego.');
  await server.db.migrate(); await server.app.listen({ host: '127.0.0.1', port: 4302 });
  const password = randomUUID() + randomUUID();
  const host = await server.accounts.register({ username, displayName: 'Anfitrión prueba real', password, invitation: (await server.accounts.invitation()).code });
  const guest = await server.accounts.register({ username: 'real_' + randomUUID().slice(0, 8), displayName: 'Invitado prueba real', password, invitation: (await server.accounts.invitation()).code });
  await server.friends.request(host.user, guest.user.username);
  await server.friends.respond(guest.user, (await server.friends.state(guest.user, () => false)).incoming[0].id, true);
  const { room } = await server.games.invite(host.user, guest.user.id);
  await server.games.respond(guest.user, (await server.games.state(guest.user)).incoming[0].id, true);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const bContext = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  await aContext.addCookies([{ name: 'nsm.sid', value: host.sessionToken, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await bContext.addCookies([{ name: 'nsm.sid', value: guest.sessionToken, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await aContext.addInitScript(() => {
    let callback: (() => void) | undefined;
    Object.defineProperty(window, 'EJS_ready', { configurable: true, set(value) { callback = value; }, get() { return () => { (window as any).EJS_emulator.debug = true; callback?.(); }; } });
  });
  const a = await aContext.newPage(), b = await bContext.newPage();
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (['error', 'warning', 'log'].includes(event.type())) { errors.push(event.text().slice(0, 1500)); console.log('Diagnóstico navegador: ' + event.text().slice(0, 1500)); } });
  }
  for (const page of [a, b]) {
    await page.goto(origin);
    await page.getByRole('button', { name: 'Juegos', exact: true }).click();
    await page.getByRole('button', { name: 'Volver a la partida de Anfitrión prueba real', exact: true }).click();
  }
  const hostFrame = a.frameLocator('iframe[title="Partida de Crash Bash"]');
  const guestFrame = b.frameLocator('iframe[title="Partida de Crash Bash"]');
  console.log('Emulador real: iniciando desde la ruta protegida de NSM.');
  progress = setInterval(() => { void hostFrame.locator('#status').textContent().then(text => console.log('Estado del arranque: ' + text)).catch(() => {}); }, 20000);
  await hostFrame.getByRole('button', { name: 'Jugar', exact: true }).click();
  const video = guestFrame.locator('#remote-video');
  await video.waitFor({ state: 'visible', timeout: 150000 });
  await b.frames().find(frame => frame.url().includes('/view'))!.waitForFunction(() => { const el = document.querySelector<HTMLVideoElement>('#remote-video'); return !!el && el.readyState >= 2 && el.getVideoPlaybackQuality().totalVideoFrames > 4; }, undefined, { timeout: 150000 });
  await b.frames().find(frame => frame.url().includes('/view'))!.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#remote-video');
    if (!video || video.readyState < 2) return false;
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 35 || pixels[i + 1] > 35 || pixels[i + 2] > 35) visible++;
    return visible > 40;
  }, undefined, { timeout: 60000, polling: 500 });
  const assets = await a.frames().find(f => f.url().includes('/view'))!.evaluate(() => {
    const fs = (window as any).EJS_emulator.gameManager.FS;
    return { biosBytes:fs.stat('/scph5502.bin').size, sbiBytes:fs.analyzePath('/game.sbi').exists ? fs.stat('/game.sbi').size : 0 };
  });
  if (assets.biosBytes !== 524288 || (config.CRASH_SBI_PATH && assets.sbiBytes < 4)) throw new Error('Archivos de compatibilidad no cargados en el emulador.');
  const result = await video.evaluate((el: HTMLVideoElement) => ({ readyState: el.readyState, decodedFrames: el.getVideoPlaybackQuality().totalVideoFrames, videoWidth: el.videoWidth, videoHeight: el.videoHeight, tracks: (el.srcObject as MediaStream).getTracks().map(track => ({ kind: track.kind, state: track.readyState })) }));
  await mkdir('.local/screenshots', { recursive: true });
  await a.screenshot({ path: '.local/screenshots/real-crash-host.png', fullPage: true });
  await b.screenshot({ path: '.local/screenshots/real-crash-guest.png', fullPage: true });
  await writeFile('.local/real-game-smoke.json', JSON.stringify({ localOnly: true, runtime: 'EmulatorJS 4.2.3', visibleImage: true, assets, result, errors }, null, 2));
  console.log('Recepción real verificada: ' + JSON.stringify(result));
  if (process.env['CRASH_ADVENTURE_TEST'] === '1') {
    const runtime = a.frames().find(f => f.url().includes('/view'))!;
    clearInterval(progress);
    console.log('ADVENTURE_READY');
    let last = '';
    for (let step = 0; step < 3600; step++) {
      const command = await readFile('.local/adventure-command.json', 'utf8').catch(() => '');
      if (command && command !== last) {
        last = command; const data = JSON.parse(command);
        if (data.stop) break;
        for (const input of data.inputs ?? []) {
          await runtime.evaluate(({seat,index,value}) => (window as any).EJS_emulator.gameManager.simulateInput(seat,index,value), {seat:input.seat??0,index:input.index,value:1});
          await a.waitForTimeout(input.ms??120);
          await runtime.evaluate(({seat,index}) => (window as any).EJS_emulator.gameManager.simulateInput(seat,index,0), {seat:input.seat??0,index:input.index});
          await a.waitForTimeout(input.wait??400);
        }
        await a.waitForTimeout(data.wait??1000);
        await hostFrame.locator('#game').screenshot({path:'.local/screenshots/adventure.png'});
        await guestFrame.locator('#game').screenshot({path:'.local/screenshots/adventure-guest.png'});
        const state = await runtime.evaluate(() => {
          const e = (window as any).EJS_emulator, m=e.gameManager;
          return {frame:m.functions.getFrameNum(),file:e.fileName,root:m.FS.readdir('/'),sbi:m.FS.analyzePath('/game.sbi').exists,options:m.functions.getCoreOptions()};
        });
        await writeFile('.local/adventure-state.json', JSON.stringify(state,null,2));
        console.log('COMMAND_DONE ' + data.id);

      }
      await a.waitForTimeout(500);
    }
  }

} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se completó la prueba real.');
  console.error('Errores de navegador: ' + JSON.stringify(errors));
  await mkdir('.local', { recursive: true });
  await writeFile('.local/real-game-error.json', JSON.stringify({ errors, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally { clearInterval(progress); await browser?.close(); await server.app.close(); }
