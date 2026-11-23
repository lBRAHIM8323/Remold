// Size labels shown in the picker and the notification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSize, sizeChange } from '../src/sizes';

test('sizes', () => {
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(38 * 1024), '38 KB');
    assert.equal(formatSize(3.25 * 1024 * 1024), '3.3 MB');
    assert.equal(formatSize(Number.NaN), 'failed');
});

test('changes', () => {
    assert.equal(sizeChange(100, 28), '−72%');
    assert.equal(sizeChange(100, 115), '+15%');
    assert.equal(sizeChange(100, 100), 'same size');
    assert.equal(sizeChange(0, 10), '');
});
