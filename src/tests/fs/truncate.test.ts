// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

const path: string = 'truncate-file.txt',
	size = 1024 * 16,
	data = new Uint8Array(size).fill('x'.charCodeAt(0));

suite('Truncating', config('truncate'), () => {
	test('Sync path functions', config('sync'), () => {
		fs.writeFileSync(path, data);
		assert.equal(fs.statSync(path).size, size);

		fs.truncateSync(path, 1024);
		assert.equal(fs.statSync(path).size, 1024);

		fs.truncateSync(path);
		assert.equal(fs.statSync(path).size, 0);

		fs.writeFileSync(path, data);
		assert.equal(fs.statSync(path).size, size);
	});

	test('Path functions reject file descriptors', config('sync'), async () => {
		const fd = fs.openSync(path, 'r+');
		const error = { name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' };
		assert.throws(() => fs.truncateSync(fd as any, 1), error);
		await assert.rejects(fs.promises.truncate(fd as any, 1), error);
		fs.closeSync(fd);
	});

	test('FD functions', config('sync'), () => {
		const fd = fs.openSync(path, 'r+');

		fs.ftruncateSync(fd, 1024);
		assert.equal(fs.fstatSync(fd).size, 1024);

		fs.ftruncateSync(fd);
		assert.equal(fs.fstatSync(fd).size, 0);

		fs.closeSync(fd);
	});

	test('Contents follow the size #313', config('sync'), () => {
		const path = 'truncate-contents.txt';
		fs.writeFileSync(path, 'SECRETDATA');

		fs.truncateSync(path, 4);
		assert.equal(fs.readFileSync(path, 'utf8'), 'SECR');

		fs.truncateSync(path, 10);
		assert.equal(fs.readFileSync(path, 'utf8'), 'SECR\0\0\0\0\0\0');
	});

	const statSize = async (path: string) => (await fs.promises.stat(path)).size;

	test('Async path functions', config('async'), async () => {
		await fs.promises.writeFile(path, data);

		assert.equal(await statSize(path), 1024 * 16);

		await fs.promises.truncate(path, 1024);
		assert.equal(await statSize(path), 1024);

		await fs.promises.truncate(path);
		assert.equal(await statSize(path), 0);

		await fs.promises.writeFile(path, data);
		assert.equal(await statSize(path), size);
	});

	test('FileHandle', config('async'), async () => {
		const handle = await fs.promises.open(path, 'w');

		await handle.truncate(1024);
		await handle.sync();
		assert.equal(await statSize(path), 1024);

		await handle.truncate();
		await handle.sync();
		assert.equal(await statSize(path), 0);

		await handle.close();
	});

	test('Contents follow the size (async) #313', config('async'), async () => {
		const path = 'truncate-contents-async.txt';
		await fs.promises.writeFile(path, 'SECRETDATA');

		await fs.promises.truncate(path, 4);
		assert.equal(await fs.promises.readFile(path, 'utf8'), 'SECR');

		await fs.promises.truncate(path, 10);
		assert.equal(await fs.promises.readFile(path, 'utf8'), 'SECR\0\0\0\0\0\0');
	});

	test('Negative lengths truncate to 0', async () => {
		const path = 'truncate-negative.txt';

		fs.writeFileSync(path, 'abc');
		fs.truncateSync(path, -1);
		assert.equal(fs.statSync(path).size, 0);

		fs.writeFileSync(path, 'abc');
		const fd = fs.openSync(path, 'r+');
		fs.ftruncateSync(fd, -1);
		assert.equal(fs.fstatSync(fd).size, 0);
		fs.closeSync(fd);

		fs.writeFileSync(path, 'abc');
		await fs.promises.truncate(path, -1);
		assert.equal(fs.statSync(path).size, 0);

		fs.writeFileSync(path, 'abc');
		await using handle = await fs.promises.open(path, 'r+');
		await handle.truncate(-1);
		assert.equal((await handle.stat()).size, 0);
	});
});
