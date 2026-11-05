import { configure as crashBash } from './crash-bash.js';
import { configure as ctr } from './crash-team-racing.js';
import { configurePSX } from './psx-adapter.js';
import { configureNeoGeo } from './neogeo-adapter.js';
const adapters = { 'dragon-ball-final-bout': context => configurePSX(context, { gameID: 200013 }), 'crash-bash': crashBash, 'crash-team-racing': ctr };
export function configureGame(context) {
  const configure = context.player.game.adapter === 'emulatorjs-neogeo' ? configureNeoGeo : adapters[context.player.gameId];
  if (!configure) throw new Error('Este juego todavía no tiene un adaptador disponible.');
  configure(context);
}
