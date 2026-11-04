// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

suite('Reading', () => {
	test('Cannot read a file with an invalid encoding', config('sync'), () => {
		assert.throws(() => fs.readFileSync('a.js', 'wrong-encoding' as BufferEncoding));
	});

	test('Reading past the end of a file should not be an error', config('async'), async () => {
		await using handle = await fs.promises.open('a.js', 'r');
		const { bytesRead } = await handle.read(new Uint8Array(10), 0, 10, 10000);
		assert.equal(bytesRead, 0);
	});

	const dir = 'test-readfile-unlink';
	const file = 'test-readfile-unlink/test.bin';
	const data = new Uint8Array(512).fill(42);

	test('create directory and write file', config('async', 'write', 'directories'), async () => {
		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, data);
	});

	test('read file and verify its content', config('async'), async () => {
		const read: Uint8Array = await fs.promises.readFile(file);
		assert.equal(read.length, data.length);
		assert.equal(read[0], 42);
	});

	test('unlink file and remove directory', config('async', 'write', 'directories'), async () => {
		await fs.promises.unlink(file);
		await fs.promises.rmdir(dir);
	});

	const fileName = 'empty.txt';

	test('read file', config('sync', 'async'), async () => {
		assert.equal((await fs.promises.readFile(fileName)).toString(), '');
		assert.equal(fs.readFileSync(fileName).toString(), '');
	});

	test('read file with utf-8 encoding', config('sync', 'async'), async () => {
		assert.equal(await fs.promises.readFile(fileName, 'utf8'), '');
		assert.equal(fs.readFileSync(fileName, 'utf8'), '');
	});

	test('read file synchronously and verify the content', config('sync'), () => {
		const content = fs.readFileSync('elipses.txt', 'utf8');

		assert.equal(content.length, 10000);

		for (let i = 0; i < content.length; i++) {
			assert.equal(content[i], '…');
		}
	});

	test('File descriptors are read from the current position and left open', config('sync'), () => {
		const file = 'readFile-fd.txt';
		fs.writeFileSync(file, 'abcdef');
		const fd = fs.openSync(file, 'r');
		fs.readSync(fd, Buffer.alloc(2));
		assert.equal(fs.readFileSync(fd, 'utf8'), 'cdef');
		assert.equal(fs.readFileSync(fd, 'utf8'), '');
		fs.fstatSync(fd);
		fs.closeSync(fd);
		fs.unlinkSync(file);
	});

	test('File descriptors are written at the current position and left open', config('sync'), () => {
		const file = 'writeFile-fd.txt';
		const fd = fs.openSync(file, 'w+');
		fs.writeSync(fd, 'abc');
		fs.writeFileSync(fd, 'XY');
		fs.writeFileSync(fd, 'Z');
		fs.closeSync(fd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'abcXYZ');

		const appendFd = fs.openSync(file, 'a');
		fs.appendFileSync(appendFd, '1');
		fs.appendFileSync(appendFd, '2');
		fs.closeSync(appendFd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'abcXYZ12');
		fs.unlinkSync(file);
	});

	test('File handles use the current position and are left open', config('async'), async () => {
		const file = 'readFile-handle.txt';
		await using handle = await fs.promises.open(file, 'w+');
		await handle.writeFile('abc');
		await handle.writeFile('def');
		assert.equal(await handle.readFile('utf8'), '');
		assert.equal(await fs.promises.readFile(handle, 'utf8'), '');
		await handle.stat();
		assert.equal(await fs.promises.readFile(file, 'utf8'), 'abcdef');
	});

	test('Callback functions accept file descriptors', config('async'), async () => {
		const file = 'callback-fd.txt';
		fs.writeFileSync(file, 'abc');
		const fd = fs.openSync(file, 'r+');

		const read = Promise.withResolvers<unknown>();
		fs.readFile(fd, 'utf8', (error, data) => (error ? read.reject(error) : read.resolve(data)));
		assert.equal(await read.promise, 'abc');

		const write = Promise.withResolvers<void>();
		fs.writeFile(fd, 'd', error => (error ? write.reject(error) : write.resolve()));
		await write.promise;

		fs.closeSync(fd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'abcd');
	});

	test('readFile with the a+ flag reads the whole file', config('sync'), () => {
		const file = 'readFile-append.txt';
		fs.writeFileSync(file, 'xyz');
		assert.equal(fs.readFileSync(file, { encoding: 'utf8', flag: 'a+' }), 'xyz');
		fs.unlinkSync(file);
	});

	test('readFile reads into a caller-supplied buffer', config('async'), async () => {
		const file = 'readFile-buffer.txt';
		fs.writeFileSync(file, 'abcdef');
		const buffer = Buffer.alloc(16);

		const contents = await fs.promises.readFile(file, { buffer });
		assert.equal(contents.buffer, buffer.buffer);
		assert.equal(contents.toString(), 'abcdef');

		assert.equal((await fs.promises.readFile(file, { buffer: size => Buffer.alloc(size) })).toString(), 'abcdef');
		assert.equal(await fs.promises.readFile(file, { buffer, encoding: 'utf8' }), 'abcdef');

		await using handle = await fs.promises.open(file);
		assert.equal((await handle.readFile({ buffer })).buffer, buffer.buffer);

		const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
		fs.readFile(file, { buffer }, (error, data) => (error ? reject(error) : resolve(data as Buffer)));
		assert.equal((await promise).buffer, buffer.buffer);

		await assert.rejects(fs.promises.readFile(file, { buffer: Buffer.alloc(2) }), { code: 'ERR_INVALID_ARG_VALUE' });
		await assert.rejects(fs.promises.readFile(file, { buffer: 'x' as any }), { code: 'ERR_INVALID_ARG_TYPE' });
		fs.unlinkSync(file);
	});
});
