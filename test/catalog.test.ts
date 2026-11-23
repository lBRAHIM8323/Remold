// Finding a file's format, targets several files share, and the menus' context keys.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Catalog } from '../src/filee/catalog';
import { QUICK_TARGETS, QUICK_TARGET_IDS, QUICK_TARGET_TITLES, menuContext } from '../src/filee/quick';
import { FAKE_FORMATS, FAKE_TARGETS } from './fakeFilee';

const catalog = Catalog.from('1.0.0', FAKE_FORMATS, FAKE_TARGETS);

test('a file\'s format comes from its extension, longest match first, any case', () => {
    assert.equal(catalog.formatOf('/a/b/Photo.JPEG')?.id, 'jpg');
    assert.equal(catalog.formatOf('/a/backup.tar.gz')?.id, 'tgz');
    assert.equal(catalog.formatOf('/a/log.gz')?.id, 'gz');
    assert.equal(catalog.formatOf('/a/notes.txt'), undefined);
    assert.equal(catalog.formatOf('/a/.png'), undefined, 'a hidden file named ".png" has no extension');
});

test('several files get the targets they share', () => {
    assert.deepEqual(catalog.commonTargets(['/x.png', '/y.jpg']), ['webp', 'pdf']);
    assert.deepEqual(catalog.commonTargets(['/x.png', '/y.txt']), [], 'an unknown file means no common target');
});

test('menu context: supported extensions and quick targets per kind of file', () => {
    const menus = menuContext(catalog);
    for (const extension of ['.png', '.PNG', '.jpeg', '.Jpeg', '.docx', '.gz', '.tgz'])
        assert.ok(menus.supported.includes(extension), extension);
    // Images get image quick targets they can reach, never their own format.
    assert.ok(menus.quick.webp.includes('.png'));
    assert.ok(!menus.quick.png.includes('.png'));
    assert.ok(menus.quick.png.includes('.jpg'));
    // A quick target only shows where its category lists it: PNG → DOCX is possible but not a quick target for images.
    assert.ok(!menus.quick.docx.includes('.png'));
    assert.ok(menus.quick.docx.includes('.pdf'), 'PDF → DOCX is quick for PDFs');
    // Archives: "Extract to Folder"; "tar.gz" is seen by VS Code as ".gz".
    assert.ok(menus.quick.folder.includes('.gz'));
});

test('every quick target has a title', () => {
    for (const id of QUICK_TARGET_IDS)
        assert.ok(QUICK_TARGET_TITLES[id], id);
    assert.ok(Object.keys(QUICK_TARGETS).length > 10);
});
