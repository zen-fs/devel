// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

suite('Opening files', () => {
	const filename = 'a.js';

	test('throw ENOENT when opening non-existent file', config('sync', 'async'), async () => {
		assert.throws(() => fs.openSync('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
		await assert.rejects(fs.promises.open('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
	});

	test('open file with mode "r"', config('async'), async () => {
		await using handle = await fs.promises.open(filename, 'r');
		assert(handle.fd >= -Infinity);
	});

	test('open file with mode "rs"', config('async'), async () => {
		await using handle = await fs.promises.open(filename, 'rs');
		assert(handle.fd >= -Infinity);
	});

	test('Windows-only open flags are 0', () => {
		for (const name of ['UV_FS_O_FILEMAP', 'UV_FS_O_TEMPORARY', 'UV_FS_O_SHORT_LIVED', 'UV_FS_O_SEQUENTIAL', 'UV_FS_O_RANDOM'] as const) {
			assert.equal(fs.constants[name as keyof typeof fs.constants], 0, name);
		}
	});
});
