// SPDX-License-Identifier: LGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function git(path: string, args: string[], input?: string): string {
	return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', maxBuffer: 1 << 30, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

export class Repository {
	readonly path: string;
	/** Resolved commit of `ref` */
	readonly hash: string;
	/** Commit date of `ref` */
	readonly date: Date;

	constructor(
		path: string,
		/** Defaults to the upstream of `main`, or `HEAD` if there is none */
		readonly ref: string = Repository.defaultRef(path),
	) {
		path = resolve(path);
		this.path = path;
		try {
			git(path, ['rev-parse', '--git-dir']);
		} catch {
			throw new Error(`Not a git repository: ${path}`);
		}

		try {
			const [hash, date] = git(path, ['log', '-1', '--format=%H%x1f%cI', ref]).trim().split('\x1f');
			this.hash = hash;
			this.date = new Date(date);
		} catch {
			throw new Error(`Unknown ref in ${path}: ${ref}`);
		}
	}

	private static defaultRef(path: string): string {
		try {
			return git(path, ['rev-parse', '--abbrev-ref', 'main@{upstream}']).trim();
		} catch {
			return 'HEAD';
		}
	}

	git(args: string[], input?: string): string {
		return git(this.path, args, input);
	}

	/**
	 * Reads a file as of `ref`.
	 */
	show(file: string): string {
		return this.git(['show', `${this.ref}:${file}`]);
	}

	/**
	 * Reads many blobs with a single `git cat-file` process.
	 */
	readBlobs(hashes: string[]): Map<string, string> {
		const blobs = new Map<string, string>();
		if (!hashes.length) return blobs;

		const output = execFileSync('git', ['-C', this.path, 'cat-file', '--batch'], { input: hashes.join('\n') + '\n', maxBuffer: 1 << 30 });

		let offset = 0;
		while (offset < output.length) {
			const headerEnd = output.indexOf(0x0a, offset);
			const [hash, type, size] = output.subarray(offset, headerEnd).toString().split(' ');
			if (type == 'missing') {
				offset = headerEnd + 1;
				continue;
			}
			const start = headerEnd + 1;
			blobs.set(hash, output.subarray(start, start + Number(size)).toString());
			offset = start + Number(size) + 1;
		}

		return blobs;
	}
}
