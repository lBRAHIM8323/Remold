// Where Remold keeps its own copy of Filee: outside VS Code's storage, which VS Code doesn't remove on uninstall, so
// Remold's uninstall hook (src/uninstall.ts) can find and remove it. One copy is shared by every VS Code on the
// computer (Stable, Insiders, VSCodium, Cursor, …); each registers itself, and the last one uninstalled removes it.
// No VS Code dependency.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

export function managedRoot(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
    if (platform === 'win32')
        return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'), 'Remold');
    if (platform === 'darwin')
        return path.posix.join(home, 'Library', 'Application Support', 'Remold');
    return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'remold');
}

const REGISTRY = 'users.json';

function read(root: string): string[] {
    try {
        return JSON.parse(readFileSync(path.join(root, REGISTRY), 'utf8')) as string[];
    } catch {
        return [];
    }
}

/** Records that the Remold installed at `extensionPath` uses the copy in `root`. */
export function register(root: string, extensionPath: string): void {
    const users = read(root);
    if (users.includes(extensionPath))
        return;
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, REGISTRY), JSON.stringify([...users, extensionPath], null, 2));
}

/**
 * Removes `extensionPath` from the users of `root`, and any user whose folder is gone. When none is left, removes
 * `root` with Remold's Filee in it. Returns whether it was removed.
 */
export function unregister(root: string, extensionPath: string, exists: (p: string) => boolean = existsSync): boolean {
    if (!existsSync(root))
        return false;
    const users = read(root).filter(user => user !== extensionPath && exists(user));
    if (users.length > 0) {
        writeFileSync(path.join(root, REGISTRY), JSON.stringify(users, null, 2));
        return false;
    }
    rmSync(root, { recursive: true, force: true });
    return true;
}
