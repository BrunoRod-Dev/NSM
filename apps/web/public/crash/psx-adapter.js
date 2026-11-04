export function configurePSX({ base, player }, { gameID }) {
  window.EJS_player = '#game'; window.EJS_core = 'psx'; window.EJS_gameUrl = `${base}/media/game.chd`; window.EJS_biosUrl = `${base}/media/bios.bin`;
  window.EJS_gameName = player.game.name; window.EJS_gameID = gameID; window.EJS_pathtodata = 'https://cdn.emulatorjs.org/4.2.3/data/'; window.EJS_language = 'es-ES'; window.EJS_startOnLoaded = false;
  if (player.hasSbi) window.EJS_externalFiles = { '/game.sbi': `${base}/media/game.sbi` };
  window.EJS_Buttons = Object.fromEntries(['playPause','restart','mute','settings','fullscreen','saveState','loadState','screenRecord','gamepad','cheat','volumeSlider','saveSavFiles','loadSavFiles','quickSave','quickLoad','screenshot','cacheManager','exitEmulation','netplay','diskButton','contextMenu'].map(key => [key, false]));
  window.EJS_defaultOptions = { 'virtual-gamepad': 'disabled', pcsx_rearmed_multitap: 'port 1', vsync: 'disabled' };
  window.EJS_ready = () => {
    // NSM owns inputs so a local controller cannot also drive a remote seat.
    if (window.EJS_emulator) { window.EJS_emulator.keyChange = () => {}; window.EJS_emulator.gamepadEvent = () => {}; }
    const prototype = window.EJS_GameManager?.prototype;
    // EmulatorJS 4.2.3 passes ArrayBuffer to FS.writeFile for external files;
    // Emscripten requires a typed array. Normalize before any assets are loaded.
    if (prototype?.writeFile) {
      const write = prototype.writeFile;
      prototype.writeFile = function(path, data) {
        return write.call(this, path, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      };
    }
    // PCSX-ReARMed discovers BIOS by supported filenames. Keep the original
    // OpenBIOS bytes, but expose them under a name the core actually loads.
    if (prototype?.loadExternalFiles) {
      const load = prototype.loadExternalFiles;
      prototype.loadExternalFiles = async function() {
        await load.call(this);
        const response = await fetch(`${base}/media/bios.bin`);
        if (!response.ok) throw new Error('No se pudo cargar la BIOS.');
        this.writeFile('/scph5502.bin', new Uint8Array(await response.arrayBuffer()));
        if (player.hasSbi && this.FS.stat('/game.sbi').size < 4) throw new Error('No se cargaron los datos del disco.');
      };
    }
    if (prototype?.getRetroArchCfg) {
      const original = prototype.getRetroArchCfg;
      prototype.getRetroArchCfg = function () {
        let config = original.call(this);
        for (const [key, value] of Object.entries({ pause_nonactive: 'false', pause_on_disconnect: 'false', video_vsync: 'false' })) {
          const pattern = new RegExp('^' + key + '\\s*=.*$', 'gm');
          config = pattern.test(config) ? config.replace(pattern, key + ' = ' + value) : config + '\n' + key + ' = ' + value + '\n';
        }
        return config;
      };
    }
    document.querySelector('#game .ejs_start_button')?.click();
  };
}
