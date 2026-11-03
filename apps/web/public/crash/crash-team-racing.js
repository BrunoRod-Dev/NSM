import { configurePSX } from './psx-adapter.js';
// Separate identity keeps CTR saves and settings apart from Crash Bash.
export function configure(context) { configurePSX(context, { gameID: 200012 }); }
