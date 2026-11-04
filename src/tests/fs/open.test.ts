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

	test('flags default to "r"', async () => {
		fs.closeSync(fs.openSync(filename));
		fs.closeSync(fs.openSync(filename, undefined));
		assert.throws(() => fs.writeSync(fs.openSync(filename), 'x'), { code: 'EBADF' });

		const handle = await fs.promises.open(filename);
		await handle.close();

		const { promise, resolve, reject } = Promise.withResolvers<number>();
		fs.open(filename, (error, fd) => (error ? reject(error) : resolve(fd!)));
		fs.closeSync(await promise);
	});

	test('Windows-only open flags are 0', () => {
		for (const name of ['UV_FS_O_FILEMAP', 'UV_FS_O_TEMPORARY', 'UV_FS_O_SHORT_LIVED', 'UV_FS_O_SEQUENTIAL', 'UV_FS_O_RANDOM'] as const) {
			assert.equal(fs.constants[name as keyof typeof fs.constants], 0, name);
		}
	});
});
