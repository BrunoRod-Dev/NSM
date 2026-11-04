export interface LibraryManifest { gameId: string; assets: { name: string; scope?: string; size: number; sha256: string; chunks: string[]; url: string }[] }
export function manifest(game: string): Promise<LibraryManifest>;
export function installed(owner: string, data: LibraryManifest): Promise<boolean>;
export function download(owner: string, data: LibraryManifest, report: (done: number, total: number) => void, signal?: AbortSignal): Promise<void>;
export function remove(owner: string, game: string): Promise<void>;
export function localFiles(owner: string, data: LibraryManifest): Promise<Record<string, File>>;
