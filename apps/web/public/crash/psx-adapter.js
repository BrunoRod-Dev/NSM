
export function configurePSX({ base, player, files }, { gameID }) {
  window.EJS_threads = false;
  window.EJS_forceLegacyCores = true;
  window.EJS_player = '#game'; window.EJS_core = 'psx'; window.EJS_gameUrl = files['game.chd']; window.EJS_biosUrl = '';
  window.EJS_gameName = player.game.name; window.EJS_gameID = gameID; window.EJS_pathtodata = 'https://cdn.emulatorjs.org/4.2.3/data/'; window.EJS_language = 'es-ES'; window.EJS_startOnLoaded = false;
  if (player.hasSbi) window.EJS_externalFiles = { '/game.sbi': files['game.sbi'] };
  window.EJS_Buttons = Object.fromEntries(['playPause','restart','mute','settings','fullscreen','saveState','loadState','screenRecord','gamepad','cheat','volumeSlider','saveSavFiles','loadSavFiles','quickSave','quickLoad','screenshot','cacheManager','exitEmulation','netplay','diskButton','contextMenu'].map(key => [key, false]));
  window.EJS_defaultOptions = { 'virtual-gamepad': 'disabled', ejs_threads: 'disabled', webgl2Enabled: 'disabled', pcsx_rearmed_multitap: (player.game.maxPlayers > 2 ? 'port 1' : 'disabled'), pcsx_rearmed_drc: 'disabled', vsync: 'disabled' };
  window.EJS_ready = () => {
    // NSM owns inputs so a local controller cannot also drive a remote seat.
    if (window.EJS_emulator) { window.EJS_emulator.keyChange = () => {}; window.EJS_emulator.gamepadEvent = () => {}; }
    const emulator = window.EJS_emulator;
    if (emulator) {
      const setting = emulator.preGetSetting;
      const fixed = {
        ejs_threads: 'disabled', webgl2Enabled: 'disabled',
        pcsx_rearmed_multitap: (player.game.maxPlayers > 2 ? 'port 1' : 'disabled'), pcsx_rearmed_drc: 'disabled',
      };
      emulator.preGetSetting = function (name) {
        return Object.hasOwn(fixed, name) ? fixed[name] : setting.call(this, name);
      };
    }
    const prototype = window.EJS_GameManager?.prototype;
    if (prototype && player.seat > 0) {
      // A visiting player uses the host's memory card only for this session.
      prototype.mountFileSystems = async function () {
        this.mkdir('/data');
        this.mkdir('/data/saves');
        this.FS.mount(this.FS.filesystems.MEMFS, {}, '/data/saves');
      };
    }
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
        let failure = 'No se pudieron preparar los archivos complementarios del disco.';
        try {
          await load.call(this);
          failure = 'No se pudo preparar la BIOS.';
        this.writeFile('/scph5502.bin', new Uint8Array(await files['bios.bin'].arrayBuffer()));
        failure = 'No se pudieron preparar los datos SBI del disco.';
        if (player.hasSbi && this.FS.stat('/game.sbi').size < 4) throw new Error('No se cargaron los datos del disco.');
        } catch (error) {
          window.dispatchEvent(new CustomEvent('nsm:boot-error', { detail: failure }));
          throw error;
        }
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
