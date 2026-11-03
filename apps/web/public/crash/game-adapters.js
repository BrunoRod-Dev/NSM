import { configure as crashBash } from './crash-bash.js';
import { configure as ctr } from './crash-team-racing.js';
const adapters = { 'crash-bash': crashBash, 'crash-team-racing': ctr };
export function configureGame(context) {
  const configure = adapters[context.player.gameId];
  if (!configure) throw new Error('Este juego todavía no tiene un adaptador disponible.');
  configure(context);
}
