// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path/posix';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';
import { data as dataPath } from '../setup.js';

const fileName = 'write.txt';
const utf8example = readFileSync(join(dataPath, 'utf8.txt'), 'utf8');

suite('Writes', config('write'), () => {
	test('Using FileHandle and UTF-8', config('async'), async () => {
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fileName, 'w', 0o644);
		await handle.write('', 0, 'utf8');
		const { bytesWritten } = await handle.write(expected, 0, 'utf8');
		assert.equal(bytesWritten, Buffer.from(expected).length);
		await handle.close();

		const data = await fs.promises.readFile(fileName, 'utf8');
		assert.equal(data, expected);

		await fs.promises.unlink(fileName);
	});

	test('Using FileHandle with buffer', config('async'), async () => {
		const expected = Buffer.from('hello');

		const handle = await fs.promises.open(fileName, 'w', 0o644);

		const written = await handle.write(expected, 0, expected.length, null);

		assert.equal(expected.length, written.bytesWritten);

		await handle.close();

		assert.deepEqual(await fs.promises.readFile(fileName), expected);

		await fs.promises.unlink(fileName);
	});

	test('Using sync path functions', config('sync'), () => {
		const fd = fs.openSync(fileName, 'w');

		let written = fs.writeSync(fd, '');
		assert.equal(written, 0);

		fs.writeSync(fd, 'foo');

		const data = Buffer.from('bár');
		written = fs.writeSync(fd, data, 0, data.length);
		assert.equal(written, 4);

		fs.closeSync(fd);

		assert.equal(fs.readFileSync(fileName, 'utf8'), 'foobár');
	});

	test('Using promises API', config('async'), async () => {
		const filename = 'test.txt';
		await fs.promises.writeFile(filename, utf8example);
		const data = await fs.promises.readFile(filename);
		assert.equal(data.length, Buffer.from(utf8example).length);
		await fs.promises.unlink(filename);
	});

	test('Using promises API with buffer', config('async'), async () => {
		const filename = 'test2.txt';
		const expected = Buffer.from(utf8example, 'utf8');

		await fs.promises.writeFile(filename, expected);
		const actual = await fs.promises.readFile(filename);
		assert.equal(actual.length, expected.length);

		await fs.promises.unlink(filename);
	});

	test('Promises API with base64 data', config('async'), async () => {
		const data = readFileSync(join(dataPath, 'image.jpg'), 'base64');

		const buffer = Buffer.from(data, 'base64');
		const filePath = 'test.jpg';

		await fs.promises.writeFile(filePath, buffer);

		const read = await fs.promises.readFile(filePath, 'base64');
		assert.equal(read, data);
	});

	test('Using sync path functions with custom mode', config('sync', 'permissions'), () => {
		const file = 'testWriteFileSync.txt';
		const mode = 0o755;

		fs.writeFileSync(file, '123', { mode });

		const content = fs.readFileSync(file, 'utf8');
		assert.equal(content, '123');
		assert.equal(fs.statSync(file).mode & 0o777, mode);

		fs.unlinkSync(file);
	});

	test('Appending to a file synchronously with custom mode', config('sync', 'appends', 'permissions'), () => {
		const file = 'testAppendFileSync.txt';
		const mode = 0o755;

		fs.appendFileSync(file, 'abc', { mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		assert.equal(content, 'abc');

		assert.equal(fs.statSync(file).mode & 0o777, mode);

		fs.unlinkSync(file);
	});

	test('writeSync with an options object', config('sync'), () => {
		const file = 'write-options-sync.txt';
		const fd = fs.openSync(file, 'w+');
		assert.equal(fs.writeSync(fd, Buffer.from('abcdef'), { offset: 1, length: 2 }), 2);
		assert.equal(fs.writeSync(fd, Buffer.from('xyz')), 3);
		fs.closeSync(fd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'bcxyz');
		fs.unlinkSync(file);
	});

	test('write with an options object', config('async'), async () => {
		const file = 'write-options.txt';
		const fd = fs.openSync(file, 'w+');
		const buffer = Buffer.from('abcdef');
		const { promise, resolve, reject } = Promise.withResolvers<[number, Buffer]>();
		fs.write(fd, buffer, { offset: 1, length: 2, position: 0 }, (error, written, result) =>
			error ? reject(error) : resolve([written!, result as Buffer]),
		);
		const [written, result] = await promise;
		assert.equal(written, 2);
		assert.equal(result, buffer);
		fs.closeSync(fd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'bc');
		fs.unlinkSync(file);
	});

	test('Positional writes do not move the file position', config('sync'), async () => {
		const file = 'write-positional.txt';
		const fd = fs.openSync(file, 'w+');
		fs.writeSync(fd, 'abc');
		fs.writeSync(fd, 'X', 0);
		fs.writeSync(fd, 'def');
		assert.equal(fs.readFileSync(file, 'utf8'), 'Xbcdef');

		await using handle = await fs.promises.open(file, 'r+');
		await handle.write('1');
		await handle.write('Y', 4);
		await handle.write('2');
		assert.equal(fs.readFileSync(file, 'utf8'), '12cdYf');

		fs.closeSync(fd);
		fs.unlinkSync(file);
	});

	test('writevSync writes at the current position and respects views', config('sync'), () => {
		const file = 'write-vectored.txt';
		const fd = fs.openSync(file, 'w+');
		const bytes = Buffer.from('xxabcxx');
		assert.equal(fs.writevSync(fd, [bytes.subarray(2, 5), Buffer.from('de')]), 5);
		assert.equal(fs.writevSync(fd, [Buffer.from('f')]), 1);
		assert.equal(fs.writevSync(fd, [Buffer.from('A')], 0), 1);
		assert.equal(fs.writevSync(fd, [Buffer.from('g')]), 1);
		fs.closeSync(fd);
		assert.equal(fs.readFileSync(file, 'utf8'), 'Abcdefg');
		fs.unlinkSync(file);
	});

	test('Objects are not coerced to strings', async () => {
		const object = { toString: () => 'x' } as any;
		const error = { name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' };
		const file = 'write-coercion.txt';

		assert.throws(() => fs.writeFileSync(file, object), error);
		assert.throws(() => fs.appendFileSync(file, object), error);
		await assert.rejects(fs.promises.writeFile(file, object), error);
		await assert.rejects(fs.promises.appendFile(file, object), error);

		await using handle = await fs.promises.open(file, 'a+');
		await assert.rejects(handle.write(object), error);
		await assert.rejects(handle.writeFile(object), error);
		await assert.rejects(handle.appendFile(object), error);
		assert.throws(() => fs.writeSync(handle.fd, object), error);
		assert.throws(() => fs.write(handle.fd, object, () => {}), error);

		assert.equal(fs.readFileSync(file, 'utf8'), '');
		fs.unlinkSync(file);
	});

	test('Non-byte views are written by byte length', async () => {
		const file = 'write-view.txt';
		const view = new Uint16Array([0x6261, 0x6463]);

		fs.writeFileSync(file, view);
		assert.equal(fs.readFileSync(file, 'latin1'), 'abcd');

		await fs.promises.writeFile(file, new DataView(view.buffer));
		assert.equal(fs.readFileSync(file, 'latin1'), 'abcd');

		fs.unlinkSync(file);
	});

	test('writeFile and appendFile write iterables', async () => {
		const path = 'write-iterable.txt';

		await fs.promises.writeFile(path, ['a', Buffer.from('b'), new Uint8Array([99])]);
		assert.equal(fs.readFileSync(path, 'utf8'), 'abc');

		await fs.promises.writeFile(
			path,
			(async function* () {
				yield 'd';
				yield Buffer.from('e');
			})(),
		);
		assert.equal(fs.readFileSync(path, 'utf8'), 'de');

		await fs.promises.writeFile(path, ['6869'], { encoding: 'hex' });
		assert.equal(fs.readFileSync(path, 'utf8'), 'hi');

		await fs.promises.appendFile(path, Readable.from(['!', '?']));
		assert.equal(fs.readFileSync(path, 'utf8'), 'hi!?');

		await using handle = await fs.promises.open(path, 'w');
		await handle.writeFile(Readable.from([Buffer.from('xy'), 'z']));
		assert.equal(fs.readFileSync(path, 'utf8'), 'xyz');

		await assert.rejects(fs.promises.writeFile(path, [1] as any), { code: 'ERR_INVALID_ARG_TYPE' });
	});
});
