// SPDX-License-Identifier: LGPL-3.0-or-later
import * as zenfs from '@zenfs/core';
import type { Api } from './docs.js';

function attempt<T>(create: () => T): T | undefined {
	try {
		return create();
	} catch {
		return undefined;
	}
}

export const version = zenfs._version;

await using stack = new AsyncDisposableStack();

const dir = '/.node-compat-probe';
const file = dir + '/file';
zenfs.rmSync(dir, { recursive: true, force: true });
zenfs.mkdirSync(dir, { recursive: true });
stack.defer(() => zenfs.rmSync(dir, { recursive: true, force: true }));
zenfs.writeFileSync(file, 'probe');

const targets: Record<string, unknown> = {
	fs: zenfs,
	fsPromises: zenfs.promises,
	FileHandle: stack.use(await zenfs.promises.open(file).catch(() => undefined)),
	Dir: stack.use(attempt(() => zenfs.opendirSync(dir))),
	Dirent: attempt(() => zenfs.readdirSync(dir, { withFileTypes: true })[0]),
	FSWatcher: stack.adopt(
		attempt(() => zenfs.watch(dir)),
		watcher => watcher?.close(),
	),
	StatWatcher: stack.adopt(
		attempt((): unknown => zenfs.watchFile(file, () => {})),
		() => zenfs.unwatchFile(file),
	),
	ReadStream: stack.use(attempt(() => zenfs.createReadStream(file))),
	WriteStream: stack.use(attempt(() => zenfs.createWriteStream(dir + '/write'))),
	Stats: attempt(() => zenfs.statSync(file)),
	StatFs: attempt(() => zenfs.statfsSync(dir)),
	Utf8Stream: stack.use(attempt(() => new zenfs.Utf8Stream({ dest: dir + '/utf8', sync: true }))),
};

export function has(api: Api): boolean {
	let target = targets[api.owner];
	if (target == null) return false;
	for (const key of api.path) {
		if ((typeof target != 'object' && typeof target != 'function') || target === null || !(key in target)) return false;
		target = (target as Record<PropertyKey, unknown>)[key];
	}
	return true;
}
