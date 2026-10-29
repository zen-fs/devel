// SPDX-License-Identifier: LGPL-3.0-or-later
import type { IndexData } from '@zenfs/core';
import { constants as c, lstatSync, readdirSync, type Stats } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path/posix';

export interface MakeIndexOptions {
	/** Glob patterns of paths to leave out */
	ignore?: string[];

	/** Include entries from devices other than the one `root` is on */
	xdev?: boolean;

	/** Called with a message when an entry crosses a device boundary */
	onWarning?(message: string): void;

	/** Called when an entry can not be added. If not set, the error is thrown. */
	onError?(path: string, error: Error): void;

	/** Called for each entry added to the index */
	onEntry?(path: string, stats: Stats): void;

	/** Called for each path left out because it matches `ignore` */
	onIgnore?(path: string): void;
}

const supportedTypes = new Set([c.S_IFBLK, c.S_IFCHR, c.S_IFIFO, c.S_IFSOCK, c.S_IFREG, c.S_IFDIR]);

/**
 * Creates an index of the host file system at `root`, for use with backends like `Fetch`
 */
export default function makeIndex(root: string = '.', options: MakeIndexOptions = {}): IndexData {
	const entries = new Map<string, Stats>();
	const seenDevs = new Set<number>();

	function computeEntries(path: string): void {
		try {
			if (options.ignore?.some(pattern => matchesGlob(path, pattern))) {
				options.onIgnore?.(path);
				return;
			}

			const stats = lstatSync(path);
			if (!seenDevs.size) seenDevs.add(stats.dev);
			else if (!seenDevs.has(stats.dev))
				if (options.xdev) {
					options.onWarning?.(
						`--xdev: Adding entries from device ${stats.dev} (${path}). You may get duplicate inos which MUST be de-duplicated manually.`,
					);
					seenDevs.add(stats.dev);
				} else {
					options.onWarning?.(`Ignoring ${path} because it crosses a device boundary`);
					return;
				}

			if (!supportedTypes.has(stats.mode & c.S_IFMT)) throw new Error(`Unknown file type: 0o${(stats.mode & c.S_IFMT).toString(8)}`);

			entries.set('/' + relative(root, path), stats);
			options.onEntry?.(path, stats);

			if (stats.isDirectory()) {
				for (const file of readdirSync(path)) computeEntries(join(path, file));
			}
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e));
			if (!options.onError) throw error;
			options.onError(path, error);
		}
	}

	computeEntries(root);

	return {
		version: 1,
		entries: Object.fromEntries(entries),
	};
}
