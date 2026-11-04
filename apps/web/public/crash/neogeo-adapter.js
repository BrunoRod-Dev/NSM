const sets = {
  'metal-slug': 'mslug', 'metal-slug-2': 'mslug2', 'metal-slug-x': 'mslugx',
  'metal-slug-3': 'mslug3', 'metal-slug-4': 'mslug4', 'metal-slug-5': 'mslug5',
};
export function configureNeoGeo({ base, player }) {
  const set = sets[player.gameId];
  if (!set) throw new Error('Juego Neo Geo desconocido.');
  window.EJS_player = '#game';
  window.EJS_core = 'arcade';
  window.EJS_gameUrl = base + '/media/' + set + '.zip';
  window.EJS_biosUrl = '';
  window.EJS_externalFiles = { '/neogeo.zip': base + '/media/neogeo.zip' };
  window.EJS_gameName = player.game.name;
  window.EJS_gameID = 210000 + Object.keys(sets).indexOf(player.gameId);
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/4.2.3/data/';
  window.EJS_language = 'es-ES';
  window.EJS_threads = false;
  window.EJS_startOnLoaded = false;
  window.EJS_Buttons = Object.fromEntries(['playPause', 'restart', 'mute', 'settings', 'fullscreen', 'saveState', 'loadState', 'screenRecord', 'gamepad', 'cheat', 'volumeSlider', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'screenshot', 'cacheManager', 'exitEmulation', 'netplay', 'diskButton', 'contextMenu'].map(key => [key, false]));
  window.EJS_defaultOptions = { 'virtual-gamepad': 'disabled' };
  window.EJS_ready = () => {
    const emulator = window.EJS_emulator;
    if (emulator) { emulator.keyChange = () => {}; emulator.gamepadEvent = () => {}; }
    const prototype = window.EJS_GameManager?.prototype;
    if (prototype?.writeFile) {
      const write = prototype.writeFile;
      prototype.writeFile = function(path, data) {
        return write.call(this, path, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      };
    }
    document.querySelector('#game .ejs_start_button')?.click();
  };
}
