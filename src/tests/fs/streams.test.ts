// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

// Top-level initialization
const testFilePath = 'test-file.txt';
const testData = 'Hello, World!';
await fs.promises.writeFile(testFilePath, testData);

const testFilePathWrite = 'test-file-write.txt';
await fs.promises.writeFile(testFilePathWrite, ''); // Ensure the file exists

suite('Streams', config('streams'), () => {
	test('ReadStream reads data correctly', (_, done) => {
		const readStream = fs.createReadStream(testFilePath);

		let data = '';
		readStream.on('data', chunk => {
			data += chunk;
		});
		readStream.on('end', () => {
			assert.equal(data, testData);
			done();
		});
		readStream.on('error', err => {
			done(err);
		});
	});

	test('ReadStream close method works', (_, done) => {
		const readStream = fs.createReadStream(testFilePath);

		let closed = false;
		readStream.on('close', () => {
			closed = true;
		});

		// Closing before the stream has finished reading is a premature close
		readStream.close(err => {
			assert.equal((err as NodeJS.ErrnoException | null)?.code, 'ERR_STREAM_PREMATURE_CLOSE');
			assert(closed);
			done();
		});
	});

	test('WriteStream writes data correctly', async () => {
		const writeStream = fs.createWriteStream(testFilePathWrite);

		const { promise, resolve, reject } = Promise.withResolvers();
		writeStream.on('finish', resolve);
		writeStream.on('error', reject);
		writeStream.end(testData, 'utf8');
		await promise;

		assert.equal(fs.readFileSync(testFilePathWrite, 'utf8'), testData);
	});

	test('WriteStream close method works', (_, done) => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		let closed = false;
		writeStream.on('close', () => {
			closed = true;
		});
		writeStream.close(err => {
			assert.ifError(err);
			assert(closed);
			done();
		});
	});

	test('createReadStream with start', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { start: 6, encoding: 'utf-8' });

		const data = (await stream.toArray()).join('');

		assert.equal(data, 'world');
	});

	test('createReadStream with end', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { end: 4, encoding: 'utf-8' });

		const data = (await stream.toArray()).join('');

		assert.equal(data, 'Hello');
	});

	test('FileHandle.createReadStream reads data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const readStream = fileHandle.createReadStream({ encoding: 'utf-8' });
		const [data] = await readStream.toArray();
		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('FileHandle.createWriteStream writes data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		const writeStream = fileHandle.createWriteStream();

		const { promise, resolve, reject } = Promise.withResolvers();
		writeStream.on('finish', resolve);
		writeStream.on('error', reject);
		writeStream.end(testData, 'utf8');
		await promise;

		const data = await fs.promises.readFile(testFilePathWrite, 'utf8');
		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('readable web stream', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const webStream = fileHandle.readableWebStream();

		let data = '';

		const decoder = new TextDecoder();

		for await (const chunk of webStream) {
			data += decoder.decode(chunk);
		}

		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('FileHandle.createReadStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		await fileHandle.close();
		// Closing invalidates the descriptor, so it fails range validation
		assert.throws(() => fileHandle.createReadStream(), { code: 'ERR_OUT_OF_RANGE' });
	});

	test('FileHandle.createWriteStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		await fileHandle.close();
		// Closing invalidates the descriptor, so it fails range validation
		assert.throws(() => fileHandle.createWriteStream(), { code: 'ERR_OUT_OF_RANGE' });
	});

	// A file large enough to span several chunks, so the read path has to stitch
	// them back together and the vnode cache has to grow to hold them.
	const large = Buffer.alloc(200 * 1024);
	for (let i = 0; i < large.length; i++) large[i] = (i * 31 + 7) & 0xff;

	test('createReadStream reads a multi-chunk file byte for byte', async () => {
		await fs.promises.writeFile('large.bin', large);

		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('large.bin')) chunks.push(chunk as Uint8Array);

		assert.deepEqual(Buffer.concat(chunks), large);
	});

	test('createReadStream honors highWaterMark as the chunk size', async () => {
		await fs.promises.writeFile('large.bin', large);

		const highWaterMark = 64 * 1024;
		const sizes: number[] = [];
		for await (const chunk of fs.createReadStream('large.bin', { highWaterMark })) sizes.push((chunk as Uint8Array).byteLength);

		// Every chunk but the last is a full highWaterMark, and they sum to the file
		assert.deepEqual(sizes.slice(0, -1), Array(sizes.length - 1).fill(highWaterMark));
		assert.equal(
			sizes.reduce((a, b) => a + b, 0),
			large.length,
		);
	});

	test('createReadStream with start and end spanning chunks', async () => {
		await fs.promises.writeFile('large.bin', large);

		// `end` is inclusive, and this range deliberately starts and stops mid-chunk
		const start = 1000;
		const end = 150_000;
		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('large.bin', { start, end, highWaterMark: 8192 })) chunks.push(chunk as Uint8Array);

		assert.deepEqual(Buffer.concat(chunks), large.subarray(start, end + 1));
	});

	test('a read stream does not read past the end of the file', async () => {
		await fs.promises.writeFile('small.bin', large.subarray(0, 10));

		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('small.bin', { highWaterMark: 64 * 1024 })) chunks.push(chunk as Uint8Array);

		assert.equal(chunks.length, 1);
		assert.deepEqual(chunks[0], large.subarray(0, 10));
	});

	test('a read stream over an empty file ends without a chunk', async () => {
		await fs.promises.writeFile('empty.bin', '');

		const chunks: unknown[] = [];
		for await (const chunk of fs.createReadStream('empty.bin')) chunks.push(chunk);

		assert.deepEqual(chunks, []);
	});

	const text = async (stream: AsyncIterable<string | Uint8Array>) => {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		return Buffer.concat(chunks).toString();
	};

	const isOpen = (fd: number) => {
		try {
			fs.fstatSync(fd);
			return true;
		} catch {
			return false;
		}
	};

	test('createReadStream uses the fd option and closes it', async () => {
		const fd = fs.openSync(testFilePath, 'r');
		assert.equal(await text(fs.createReadStream(null as any, { fd })), testData);
		await new Promise(resolve => setTimeout(resolve, 10));
		assert(!isOpen(fd));
	});

	test('createReadStream leaves the fd open with autoClose false', async () => {
		const fd = fs.openSync(testFilePath, 'r');
		assert.equal(await text(fs.createReadStream(null as any, { fd, autoClose: false, start: 7 })), testData.slice(7));
		await new Promise(resolve => setTimeout(resolve, 10));
		assert(isOpen(fd));
		fs.closeSync(fd);
	});

	test('createWriteStream uses the fd option', async () => {
		const file = 'stream-write-fd.txt';
		const fd = fs.openSync(file, 'w');
		const stream = fs.createWriteStream(null as any, { fd });
		await new Promise<void>((resolve, reject) => stream.end('written', (error?: Error | null) => (error ? reject(error) : resolve())));
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(fs.readFileSync(file, 'utf8'), 'written');
		assert(!isOpen(fd));
	});

	test('createWriteStream uses the flags option', async () => {
		const file = 'stream-append.txt';
		fs.writeFileSync(file, 'x');
		const stream = fs.createWriteStream(file, { flags: 'a' });
		await new Promise(resolve => stream.end('y', resolve));
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(fs.readFileSync(file, 'utf8'), 'xy');
	});

	test('readableWebStream closes the handle with autoClose', async () => {
		const handle = await fs.promises.open(testFilePath);
		const chunks: Buffer[] = [];
		for await (const chunk of handle.readableWebStream({ autoClose: true }) as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
		assert.equal(Buffer.concat(chunks).toString(), testData);
		assert.equal(handle.fd, -1);

		const cancelled = await fs.promises.open(testFilePath);
		await cancelled.readableWebStream({ autoClose: true }).cancel();
		assert.equal(cancelled.fd, -1);
	});

	test('Streams without start read from the current position', async () => {
		const handle = await fs.promises.open(testFilePath);
		await handle.read(Buffer.alloc(7));
		assert.equal(await text(handle.createReadStream({ autoClose: false })), testData.slice(7));
		assert.equal((await handle.read(Buffer.alloc(1))).bytesRead, 0);
		await handle.close();

		const fd = fs.openSync(testFilePath, 'r');
		fs.readSync(fd, Buffer.alloc(7));
		assert.equal(await text(fs.createReadStream(null as any, { fd, autoClose: false, end: 2 })), testData.slice(7, 10));
		fs.closeSync(fd);

		const webHandle = await fs.promises.open(testFilePath);
		await webHandle.read(Buffer.alloc(7));
		assert.equal(await text(webHandle.readableWebStream()), testData.slice(7));
		await webHandle.close();
	});

	test('Streams with start do not move the current position', async () => {
		const fd = fs.openSync(testFilePath, 'r');
		fs.readSync(fd, Buffer.alloc(7));
		assert.equal(await text(fs.createReadStream(null as any, { fd, autoClose: false, start: 0, end: 4 })), testData.slice(0, 5));
		const next = Buffer.alloc(1);
		fs.readSync(fd, next);
		assert.equal(next.toString(), testData[7]);
		fs.closeSync(fd);
	});

	test('Streams expose fd, which stays open with autoClose false', async () => {
		const path = 'stream-fd.txt';
		const stream = fs.createWriteStream(path, { autoClose: false });
		assert.equal(stream.fd, null);

		await new Promise(resolve => stream.end('abc', () => resolve(null)));
		assert.equal(typeof stream.fd, 'number');
		fs.writeSync(stream.fd!, 'd');
		fs.closeSync(stream.fd!);
		assert.equal(fs.readFileSync(path, 'utf8'), 'abcd');

		const closing = fs.createWriteStream(path);
		await new Promise(resolve => closing.end('x', () => closing.on('close', resolve)));
		assert.equal(closing.fd, null);
	});

	test('Write streams without start write at the current position', async () => {
		const path = 'stream-write-position.txt';
		fs.writeFileSync(path, '12345');
		const fd = fs.openSync(path, 'r+');
		fs.readSync(fd, Buffer.alloc(2));

		const stream = fs.createWriteStream(null as any, { fd, autoClose: false });
		await new Promise(resolve => stream.end('XY', () => resolve(null)));
		fs.writeSync(fd, '!');
		fs.closeSync(fd);
		assert.equal(fs.readFileSync(path, 'utf8'), '12XY!');
	});

	test('Streams emit open and ready only when they open the file', async () => {
		const path = 'stream-events.txt';
		fs.writeFileSync(path, 'abc');

		async function events(stream: InstanceType<typeof fs.ReadStream> | InstanceType<typeof fs.WriteStream>): Promise<string[]> {
			const emitted: string[] = [];
			for (const event of ['open', 'ready', 'end', 'finish', 'close']) {
				stream.on(event, (fd: unknown) => emitted.push(event == 'open' ? `open(${typeof fd})` : event));
			}
			if (stream instanceof fs.ReadStream) stream.resume();
			else stream.end();
			await new Promise(resolve => stream.on('close', resolve));
			return emitted;
		}

		assert.deepEqual(await events(fs.createReadStream(path)), ['open(number)', 'ready', 'end', 'close']);
		assert.deepEqual(await events(fs.createWriteStream(path)), ['open(number)', 'ready', 'finish', 'close']);
		assert.deepEqual(await events(fs.createReadStream(null as any, { fd: fs.openSync(path, 'r') })), ['end', 'close']);
		assert.deepEqual(await events(fs.createWriteStream(null as any, { fd: fs.openSync(path, 'w') })), ['finish', 'close']);
	});

	test('Streams use the fs option', async () => {
		const path = 'stream-fs-option.txt';
		fs.writeFileSync(path, 'hello');
		const calls: string[] = [];

		const operations = {
			open: (_: unknown, flags: string, mode: number, callback: (error: Error | null, fd: number) => void) => {
				calls.push('open');
				fs.open(path, flags, mode, callback as any);
			},
			read: (...args: Parameters<typeof fs.read>) => {
				calls.push('read');
				(fs.read as (...args: unknown[]) => void)(...args);
			},
			write: (...args: Parameters<typeof fs.write>) => {
				calls.push('write');
				(fs.write as (...args: unknown[]) => void)(...args);
			},
			close: (fd: number, callback: (error: Error | null) => void) => {
				calls.push('close');
				fs.close(fd, callback as any);
			},
		};

		let data = '';
		for await (const chunk of fs.createReadStream(path, { fs: operations, encoding: 'utf8' })) data += chunk;
		assert.equal(data, 'hello');
		assert.deepEqual([calls[0], calls.at(-1)], ['open', 'close']);
		assert(calls.includes('read'));

		calls.length = 0;
		const writer = fs.createWriteStream(path, { fs: operations });
		await new Promise(resolve => writer.end('written', () => writer.on('close', resolve)));
		assert.equal(fs.readFileSync(path, 'utf8'), 'written');
		assert.deepEqual(calls, ['open', 'write', 'close']);

		// Without opening or closing, `open` and `close` are not needed
		calls.length = 0;
		const fd = fs.openSync(path, 'r');
		data = '';
		for await (const chunk of fs.createReadStream(null as any, { fd, fs: { read: operations.read }, autoClose: false, encoding: 'utf8' }))
			data += chunk;
		fs.closeSync(fd);
		assert.equal(data, 'written');

		assert.throws(() => fs.createReadStream(path, { fs: { read: operations.read, close: operations.close } }), {
			code: 'ERR_INVALID_ARG_TYPE',
			message: /options\.fs\.open/,
		});
		assert.throws(() => fs.createReadStream(path, { fs: { open: operations.open, read: operations.read } }), {
			code: 'ERR_INVALID_ARG_TYPE',
			message: /options\.fs\.close/,
		});
		assert.throws(() => fs.createWriteStream(path, { fs: { open: operations.open, close: operations.close } as any }), {
			code: 'ERR_INVALID_ARG_TYPE',
			message: /options\.fs\.write/,
		});
	});
});
