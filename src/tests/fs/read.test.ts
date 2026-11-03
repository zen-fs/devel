// SPDX-License-Identifier: LGPL-3.0-or-later
import { sync } from '@zenfs/core';
import { Buffer } from 'buffer';
import assert from 'node:assert/strict';
import type { OpenMode, PathLike } from 'node:fs';
import { suite, test } from 'node:test';
import { promisify } from 'node:util';
import { config, fs } from '../common.js';

const filepath = 'x.txt';
const expected = 'xyz\n';
const ellipses = '…'.repeat(10_000);

suite('read', () => {
	test('read file asynchronously', config('async'), async () => {
		await using handle = await fs.promises.open(filepath, 'r');
		const { bytesRead, buffer } = await handle.read(Buffer.alloc(expected.length), 0, expected.length, 0);
		assert.equal(bytesRead, expected.length);
		assert.equal(buffer.toString(), expected);
	});

	test('read file synchronously', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = fs.readSync(fd, buffer, 0, expected.length, 0);

		assert.equal(bytesRead, expected.length);
		assert.equal(buffer.toString(), expected);
	});

	test('Read a file and check its binary bytes asynchronously', config('async'), async () => {
		const buff = await fs.promises.readFile('elipses.txt');
		assert.equal(buff.length, 30_000);
		assert.equal(buff.toString(), ellipses);
		assert.equal((buff[1] << 8) | buff[0], 32994);
	});

	test('Read a file and check its binary bytes synchronously', config('sync'), () => {
		const buff = fs.readFileSync('elipses.txt');
		assert.equal(buff.length, 30_000);
		assert.equal(buff.toString(), ellipses);
		assert.equal((buff[1] << 8) | buff[0], 32994);
	});

	const bufferAsync = Buffer.alloc(expected.length);
	const bufferSync = Buffer.alloc(expected.length);

	test('read file from handle asynchronously', config('async'), async () => {
		await using handle = await fs.promises.open(filepath, 'r');
		const { bytesRead } = await handle.read(bufferAsync, 0, expected.length, 0);

		assert.equal(bytesRead, expected.length);
		assert.equal(bufferAsync.toString(), expected);
	});

	test('read file from handle synchronously', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const bytesRead = fs.readSync(fd, bufferSync, 0, expected.length, 0);

		assert.equal(bufferSync.toString(), expected);
		assert.equal(bytesRead, expected.length);
	});

	test('read file synchronously to non-zero offset', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length + 10);
		const bytesRead = fs.readSync(fd, buffer, 10, expected.length, 0);

		assert.equal(buffer.subarray(10, buffer.length).toString(), expected);
		assert.equal(bytesRead, expected.length);
	});

	test('fractional read lengths are truncated asynchronously', config('async'), async () => {
		await using handle = await fs.promises.open(filepath, 'r');
		const { bytesRead } = await handle.read(Buffer.alloc(expected.length), 0, 2.7, 0);
		assert.equal(bytesRead, 2);
	});

	test('fractional read lengths are truncated synchronously', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		assert.equal(fs.readSync(fd, Buffer.alloc(expected.length), 0, 2.7, 0), 2);
		fs.closeSync(fd);
	});

	test('read with an options object and a callback', config('async'), async () => {
		const fd = fs.openSync(filepath, 'r');
		const read = (...args: unknown[]) => {
			const { promise, resolve, reject } = Promise.withResolvers<[number, Buffer]>();
			(fs.read as (...args: unknown[]) => void)(fd, ...args, (error: Error | null, bytesRead: number, buffer: Buffer) =>
				error ? reject(error) : resolve([bytesRead, buffer]),
			);
			return promise;
		};

		const [bytesRead, buffer] = await read(Buffer.alloc(expected.length), { length: 2, position: 0 });
		assert.equal(bytesRead, 2);
		assert.equal(buffer.subarray(0, 2).toString(), expected.slice(0, 2));

		const target = Buffer.alloc(expected.length);
		const [bytesReadWithBuffer, bufferFromOptions] = await read({ buffer: target, position: 0 });
		assert.equal(bytesReadWithBuffer, expected.length);
		assert.equal(bufferFromOptions, target);
		assert.equal(target.toString(), expected);

		fs.closeSync(fd);
	});

	test('positional reads do not move the file position', config('sync'), async () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(1);
		fs.readSync(fd, buffer, 0, 1, null);
		fs.readSync(fd, buffer, 0, 1, 3);
		fs.readSync(fd, buffer, 0, 1, null);
		assert.equal(buffer.toString(), expected[1]);
		fs.closeSync(fd);

		await using handle = await fs.promises.open(filepath, 'r');
		await handle.read(buffer, 0, 1, null);
		await handle.read(buffer, 0, 1, 3);
		await handle.read(buffer, 0, 1, null);
		assert.equal(buffer.toString(), expected[1]);
	});

	test('readv reads at the current position', config('sync'), async () => {
		const fd = fs.openSync(filepath, 'r');
		const [first, second] = [Buffer.alloc(1), Buffer.alloc(2)];
		assert.equal(fs.readvSync(fd, [first]), 1);
		assert.equal(fs.readvSync(fd, [second]), 2);
		assert.equal(first.toString() + second.toString(), expected.slice(0, 3));
		fs.closeSync(fd);

		await using handle = await fs.promises.open(filepath, 'r');
		await handle.readv([first], 2);
		await handle.readv([second]);
		assert.equal(first.toString() + second.toString(), expected[2] + expected.slice(0, 2));
	});

	test('read using callback API #239', config('sync', 'write'), async () => {
		const path = '/text.txt';

		fs.writeFileSync(path, 'hello world');
		await sync();

		const fd: number = (await promisify<PathLike, OpenMode, number | string>(fs.open)(path, 0, 0)) as any;

		const read = promisify(fs.read);

		const buf = Buffer.alloc(1024);
		const n0 = await read(fd, buf, 0, 1024, undefined);
		assert.equal(n0, 11);
		assert.equal(buf.subarray(0, n0).toString('utf8'), 'hello world');

		const n1 = await read(fd, buf, 0, 1024, undefined);
		assert.equal(n1, 0);
		assert.equal(buf.subarray(0, n1).toString('utf8'), '');

		await promisify(fs.close)(fd);
	});
});
