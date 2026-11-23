// Finds Filee's command-line program ("filee", installed with the Filee app). No VS Code dependency.
import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

/**
 * Where Filee's installers put the program, most likely first:
 * - Linux (install.sh): ~/.local/bin/filee → ~/.local/share/filee/application/filee-cli
 * - macOS (install.sh): ~/.local/bin/filee → ~/Applications/Filee.app/Contents/MacOS/filee-cli
 * - Windows (Setup): %LocalAppData%\Programs\Filee or %ProgramFiles%\Filee, with filee-cli.exe; cli\filee.cmd is
 *   what Setup puts on PATH, but a .cmd needs a shell to run, so the .exe next to it is used instead.
 */
export function candidatePaths(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env,
    home = homedir()): string[] {
    // The PATH separator of the platform asked about (";" on Windows), not of the one running.
    const onPath = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
    if (platform === 'win32') {
        const roots = [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles].filter(Boolean) as string[];
        return [
            ...roots.map(root => path.win32.join(root, 'Filee', 'filee-cli.exe')),
            // cli\filee.cmd on PATH → the Filee folder above it.
            ...onPath.filter(dir => path.win32.basename(dir).toLowerCase() === 'cli').map(dir => path.win32.join(dir, '..', 'filee-cli.exe')),
            ...onPath.map(dir => path.win32.join(dir, 'filee-cli.exe')),
        ];
    }
    const posix = path.posix;
    return [
        ...onPath.map(dir => posix.join(dir, 'filee')),
        posix.join(home, '.local', 'bin', 'filee'),
        ...(platform === 'darwin'
            ? [posix.join(home, 'Applications', 'Filee.app', 'Contents', 'MacOS', 'filee-cli'), '/Applications/Filee.app/Contents/MacOS/filee-cli']
            : [posix.join(home, '.local', 'share', 'filee', 'application', 'filee-cli')]),
    ];
}

/** The configured program if it exists, otherwise the first installed one; undefined when Filee isn't found. */
export function locateFilee(configured: string | undefined, platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env, home = homedir()): string | undefined {
    if (configured)
        return runnable(configured, platform) ? configured : undefined;
    return [...new Set(candidatePaths(platform, env, home))].find(p => runnable(p, platform));
}

function runnable(file: string, platform: NodeJS.Platform): boolean {
    try {
        if (!existsSync(file))
            return false;
        accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
    } catch {
        return false;
    }
}
