// Runs once after Remold is uninstalled ("vscode:uninstall" in package.json; plain Node, no VS Code API): removes
// Remold's copy of Filee unless another VS Code on this computer still uses it.
import * as path from 'node:path';
import { managedRoot, unregister } from './filee/paths';

// This file is dist/uninstall.js inside the extension's folder.
const extensionPath = path.resolve(__dirname, '..');
try {
    if (unregister(managedRoot(), extensionPath))
        console.log(`Remold: removed ${managedRoot()}`);
} catch (error) {
    console.error(`Remold: couldn't remove ${managedRoot()}: ${error instanceof Error ? error.message : error}`);
}
