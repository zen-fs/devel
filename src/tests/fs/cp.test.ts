// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

/** Creates an empty directory for a test, replacing any previous one */
function fresh(name: string): string {
	const path = '/cp-' + name;
	fs.rmSync(path, { recursive: true, force: true });
	fs.mkdirSync(path);
	return path;
}

suite('cp', () => {
	test('errorOnExist throws for an existing directory when force is false', config('sync'), async () => {
		const root = fresh('error-on-exist');
		fs.mkdirSync(root + '/source');
		fs.mkdirSync(root + '/destination');

		const options = { recursive: true, errorOnExist: true, force: false };
		assert.throws(() => fs.cpSync(root + '/source', root + '/destination', options), { code: /EEXIST/ });
		await assert.rejects(fs.promises.cp(root + '/source', root + '/destination', options), { code: /EEXIST/ });
	});

	test('errorOnExist is ignored when force is true', config('sync'), async () => {
		const root = fresh('error-on-exist-force');
		fs.mkdirSync(root + '/source');
		fs.writeFileSync(root + '/source/file', 'new');
		fs.mkdirSync(root + '/destination');
		fs.writeFileSync(root + '/destination/file', 'old');

		fs.cpSync(root + '/source', root + '/destination', { recursive: true, errorOnExist: true });
		assert.equal(fs.readFileSync(root + '/destination/file', 'utf8'), 'new');

		fs.writeFileSync(root + '/destination/file', 'old');
		await fs.promises.cp(root + '/source', root + '/destination', { recursive: true, errorOnExist: true, force: true });
		assert.equal(fs.readFileSync(root + '/destination/file', 'utf8'), 'new');
	});

	test('filter applies to the source itself', config('sync'), async () => {
		const root = fresh('filter-root');
		fs.mkdirSync(root + '/source');
		fs.writeFileSync(root + '/source/file', '');

		fs.cpSync(root + '/source', root + '/sync', { recursive: true, filter: () => false });
		assert(!fs.existsSync(root + '/sync'));

		await fs.promises.cp(root + '/source', root + '/async', { recursive: true, filter: () => false });
		assert(!fs.existsSync(root + '/async'));
	});

	test('filter is called once per entry', config('sync'), () => {
		const root = fresh('filter-calls');
		fs.mkdirSync(root + '/source/nested', { recursive: true });
		fs.writeFileSync(root + '/source/nested/file', '');

		const sources: string[] = [];
		fs.cpSync(root + '/source', root + '/destination', {
			recursive: true,
			filter: source => (sources.push(source), true),
		});
		assert.deepEqual(
			sources.map(source => source.slice(source.indexOf(root))),
			[root + '/source', root + '/source/nested', root + '/source/nested/file'],
		);
	});

	test('cp awaits asynchronous filters', config('sync'), async () => {
		const root = fresh('filter-async');
		fs.mkdirSync(root + '/source');
		fs.writeFileSync(root + '/source/kept', '');
		fs.writeFileSync(root + '/source/skipped', '');

		await fs.promises.cp(root + '/source', root + '/destination', {
			recursive: true,
			filter: async source => !source.endsWith('skipped'),
		});
		assert.deepEqual(fs.readdirSync(root + '/destination'), ['kept']);
	});

	test('cpSync rejects asynchronous filters', config('sync'), () => {
		const root = fresh('filter-async-sync');
		fs.mkdirSync(root + '/source');

		assert.throws(() => fs.cpSync(root + '/source', root + '/destination', { recursive: true, filter: (async () => true) as any }), {
			code: 'ERR_INVALID_RETURN_VALUE',
		});
	});

	test('created directories get the source directory mode', config('sync', 'permissions'), async () => {
		const root = fresh('directory-mode');
		fs.mkdirSync(root + '/source/nested', { recursive: true, mode: 0o750 });
		fs.writeFileSync(root + '/source/nested/file', '');
		fs.chmodSync(root + '/source/nested', 0o550);
		fs.chmodSync(root + '/source', 0o700);

		fs.cpSync(root + '/source', root + '/sync', { recursive: true });
		assert.equal(fs.statSync(root + '/sync').mode & 0o777, 0o700);
		assert.equal(fs.statSync(root + '/sync/nested').mode & 0o777, 0o550);
		assert(fs.existsSync(root + '/sync/nested/file'));

		await fs.promises.cp(root + '/source', root + '/async', { recursive: true });
		assert.equal(fs.statSync(root + '/async').mode & 0o777, 0o700);
		assert.equal(fs.statSync(root + '/async/nested').mode & 0o777, 0o550);
		assert(fs.existsSync(root + '/async/nested/file'));

		for (const path of ['/source/nested', '/sync/nested', '/async/nested']) fs.chmodSync(root + path, 0o750);
	});

	test('existing symlinks at the destination are replaced', config('sync', 'symlinks'), async () => {
		const root = fresh('existing-symlink');
		fs.mkdirSync(root + '/source');
		fs.mkdirSync(root + '/sync');
		fs.mkdirSync(root + '/async');
		fs.writeFileSync(root + '/old', '');
		fs.writeFileSync(root + '/new', '');
		fs.symlinkSync(root + '/new', root + '/source/link');
		fs.symlinkSync(root + '/old', root + '/sync/link');
		fs.symlinkSync(root + '/old', root + '/async/link');

		fs.cpSync(root + '/source', root + '/sync', { recursive: true });
		assert(fs.readlinkSync(root + '/sync/link', 'utf8').endsWith('/new'));

		await fs.promises.cp(root + '/source', root + '/async', { recursive: true });
		assert(fs.readlinkSync(root + '/async/link', 'utf8').endsWith('/new'));
	});

	test('existing files are kept when force is false', config('sync'), async () => {
		const root = fresh('no-force');
		fs.mkdirSync(root + '/source');
		fs.writeFileSync(root + '/source/existing', 'new');
		fs.writeFileSync(root + '/source/added', 'added');
		fs.utimesSync(root + '/source/existing', 1000, 1000);

		for (const name of ['sync', 'async']) {
			fs.mkdirSync(root + '/' + name);
			fs.writeFileSync(root + '/' + name + '/existing', 'old');
			fs.utimesSync(root + '/' + name + '/existing', 2000, 2000);
		}

		const options = { recursive: true, force: false, preserveTimestamps: true };
		fs.cpSync(root + '/source', root + '/sync', options);
		await fs.promises.cp(root + '/source', root + '/async', options);

		for (const name of ['sync', 'async']) {
			assert.equal(fs.readFileSync(root + '/' + name + '/existing', 'utf8'), 'old');
			assert.equal(fs.statSync(root + '/' + name + '/existing').mtimeMs, 2_000_000);
			assert.equal(fs.readFileSync(root + '/' + name + '/added', 'utf8'), 'added');
		}
	});

	test('dereference copies the targets of symlinks', config('sync', 'symlinks'), async () => {
		const root = fresh('dereference');
		fs.mkdirSync(root + '/directory');
		fs.writeFileSync(root + '/directory/file', 'content');
		fs.writeFileSync(root + '/file', 'content');
		fs.mkdirSync(root + '/source');
		fs.symlinkSync(root + '/directory', root + '/source/directory-link');
		fs.symlinkSync(root + '/file', root + '/source/file-link');

		const options = { recursive: true, dereference: true };
		fs.cpSync(root + '/source', root + '/sync', options);
		await fs.promises.cp(root + '/source', root + '/async', options);

		for (const name of ['sync', 'async']) {
			assert(fs.lstatSync(`${root}/${name}/directory-link`).isDirectory());
			assert.equal(fs.readFileSync(`${root}/${name}/directory-link/file`, 'utf8'), 'content');
			assert(fs.lstatSync(`${root}/${name}/file-link`).isFile());
		}

		fs.cpSync(root + '/source/directory-link', root + '/top-level', options);
		assert(fs.lstatSync(root + '/top-level').isDirectory());
	});

	test('existing destination files are replaced, not written through', config('sync', 'symlinks'), async () => {
		const root = fresh('replace');
		fs.writeFileSync(root + '/source', 'new');
		fs.writeFileSync(root + '/target', 'target');

		for (const name of ['sync', 'async']) fs.symlinkSync(root + '/target', `${root}/${name}`);

		const options = { mode: fs.constants.COPYFILE_EXCL };
		fs.cpSync(root + '/source', root + '/sync', options);
		await fs.promises.cp(root + '/source', root + '/async', options);

		for (const name of ['sync', 'async']) {
			assert(fs.lstatSync(`${root}/${name}`).isFile());
			assert.equal(fs.readFileSync(`${root}/${name}`, 'utf8'), 'new');
		}
		assert.equal(fs.readFileSync(root + '/target', 'utf8'), 'target');
	});

	test('copying between directories and non-directories throws', config('sync'), async () => {
		const root = fresh('type-mismatch');
		fs.mkdirSync(root + '/directory');
		fs.writeFileSync(root + '/file', '');

		const toFile = { code: 'ERR_FS_CP_DIR_TO_NON_DIR' };
		assert.throws(() => fs.cpSync(root + '/directory', root + '/file', { recursive: true }), toFile);
		await assert.rejects(fs.promises.cp(root + '/directory', root + '/file', { recursive: true }), toFile);

		const toDirectory = { code: 'ERR_FS_CP_NON_DIR_TO_DIR' };
		assert.throws(() => fs.cpSync(root + '/file', root + '/directory'), toDirectory);
		await assert.rejects(fs.promises.cp(root + '/file', root + '/directory'), toDirectory);
	});
});
