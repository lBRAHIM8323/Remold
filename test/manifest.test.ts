// Keeps package.json's menus in step with the formats and commands Remold has.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { INPUT_EXTENSIONS, TARGET_FORMATS } from '../src/formats';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const menus = manifest.contributes.menus;
const regexIn = (when: string) => {
    const match = /resourceExtname =~ \/(.+?)\/i/.exec(when)!;
    return new RegExp(match[1], 'i');
};

test('"Convert to" appears for every supported extension, in the Explorer and on editor tabs', () => {
    for (const menu of ['explorer/context', 'editor/title/context']) {
        const entry = menus[menu].find((m: { submenu?: string }) => m.submenu === 'remold.convertSubmenu');
        assert.ok(entry, `${menu} has the submenu`);
        const matcher = regexIn(entry.when);
        for (const extension of INPUT_EXTENSIONS)
            assert.ok(matcher.test(`.${extension}`), `.${extension} missing from ${menu}`);
        assert.ok(!matcher.test('.txt'));
    }
});

test('every common format has a command in the submenu, hidden for its own format', () => {
    const items = menus['remold.convertSubmenu'];
    const sameFormat: Record<string, string[]> = { png: ['.png', '.PNG'], jpg: ['.jpg', '.jpeg', '.jfif'], webp: ['.webp'], avif: ['.avif'], gif: ['.gif'], ico: ['.ico'] };
    for (const format of TARGET_FORMATS.filter(t => t.common)) {
        const item = items.find((i: { command: string }) => i.command === `remold.to.${format.id}`);
        assert.ok(item, `remold.to.${format.id} in the submenu`);
        const shown = regexIn(item.when);
        for (const own of sameFormat[format.id])
            assert.ok(!shown.test(own), `${format.id} hidden for ${own}`);
        assert.ok(shown.test('.tiff'), `${format.id} shown for .tiff`);
    }
    assert.ok(items.some((i: { command: string }) => i.command === 'remold.moreFormats'));
});

test('every command in a menu is declared', () => {
    const declared = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
    for (const entries of Object.values(menus) as { command?: string }[][])
        for (const entry of entries)
            if (entry.command)
                assert.ok(declared.has(entry.command), `${entry.command} is declared`);
});
