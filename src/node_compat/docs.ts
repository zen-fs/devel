// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Repository } from './git.js';

export const fs = 'doc/api/fs.md';

export interface ApiChange {
	versions: string[];
	pr?: number;
	description: string;
}

export type ApiKind = 'module' | 'class' | 'member' | 'constant';

export class Api {
	/** Headings from the docs, without backticks */
	readonly signatures: string[] = [];
	readonly added: string[] = [];
	readonly deprecated: string[] = [];
	readonly removed: string[] = [];
	readonly changes: ApiChange[] = [];
	stability?: number;

	constructor(
		/** `<owner>.<path>` for modules, classes, and constants; `<Class>#<member>` for members */
		readonly id: string,
		readonly kind: ApiKind,
		/** The object the API lives on: `fs`, `fsPromises`, or a class name */
		readonly owner: string,
		/** Property path from `owner` */
		readonly path: (string | symbol)[],
		/** Top-level docs section */
		readonly section: string,
	) {}

	/**
	 * Adds metadata from a YAML doc comment, skipping duplicates.
	 */
	merge(yaml: Yaml): void {
		for (const key of ['added', 'deprecated', 'removed'] as const) {
			for (const version of yaml[key]) if (!this[key].includes(version)) this[key].push(version);
		}
		for (const change of yaml.changes) {
			if (!this.changes.some(other => other.pr == change.pr && other.description == change.description)) this.changes.push(change);
		}
	}

	toJSON() {
		return { ...this, path: formatPath(this.path) };
	}

	/**
	 * @param text Contents of the `fs` docs
	 */
	static parse(text: string): Map<string, Api> {
		const apis = new Map<string, Api>();
		const lines = text.split('\n');
		let section = '';
		let currentClass: string | undefined;
		let classDepth = 0;
		let current: Api | undefined;
		let inConstants = false;

		function add(id: string, kind: ApiKind, owner: string, path: (string | symbol)[], signature: string): Api {
			let api = apis.get(id);
			if (!api) apis.set(id, (api = new Api(id, kind, owner, path, section)));
			api.signatures.push(signature);
			return api;
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			if (line.startsWith('<!-- YAML') && current) {
				const end = lines.indexOf('-->', i);
				current.merge(parseYaml(lines.slice(i + 1, end)));
				i = end;
				continue;
			}

			const stability = /^> Stability: (\d)/.exec(line);
			if (stability && current && current.stability === undefined) {
				current.stability = Number(stability[1]);
				continue;
			}

			const constant = inConstants && /^\s*<td><code>(\w+)<\/code><\/td>/.exec(line);
			if (constant) {
				add('fs.constants.' + constant[1], 'constant', 'fs', ['constants', constant[1]], constant[1]);
				continue;
			}

			const heading = /^(#{2,5}) (.*)$/.exec(line);
			if (!heading) continue;

			const [, hashes, title] = heading;
			const depth = hashes.length;
			current = undefined;

			if (depth == 2) section = title;
			if (depth <= 4) inConstants = title == 'FS constants';
			if (depth <= classDepth) currentClass = undefined;

			const classHeading = /^Class:? `?((?:fs\.)?(\w+))`?$/.exec(title);
			if (classHeading) {
				currentClass = classHeading[2];
				classDepth = depth;
				current = add(classHeading[1], 'class', currentClass, [], title);
				continue;
			}

			const code = /^`(.+)`$/.exec(title)?.[1] ?? (/^(new )?[\w$]+(\.[\w$]+|\[Symbol\.\w+\])*(\(.*)?$/.test(title) ? title : undefined);
			if (!code) continue;

			const constructor = /^new (?:fs\.)?(\w+)\(/.exec(code);
			if (constructor) {
				current = add('fs.' + constructor[1], 'class', constructor[1], [], code);
				continue;
			}

			const expression = /^[\w$.]+(?:\[Symbol\.\w+\])?/.exec(code)?.[0];
			if (!expression) continue;
			const [prefix] = expression.split(/[.[]/);

			if (prefix == 'fs' || prefix == 'fsPromises') {
				const path = parsePath(expression.slice(prefix.length));
				current = add(prefix + formatPath(['', ...path]), 'module', prefix, path, code);
				continue;
			}

			const owner = prefix == 'watcher' ? currentClass : ownerPrefixes[prefix];
			if (!owner) continue;
			const path = parsePath(expression.slice(prefix.length));
			current = add(owner + '#' + formatPath(path), 'member', owner, path, code);
		}

		return apis;
	}

	static read(repo: Repository, path: string = fs): Map<string, Api> {
		return this.parse(repo.show(path));
	}
}

export interface Yaml {
	added: string[];
	deprecated: string[];
	removed: string[];
	changes: ApiChange[];
}

type VersionListKey = 'added' | 'deprecated' | 'removed';

const versionListKeys: readonly string[] = ['added', 'deprecated', 'removed'] satisfies VersionListKey[];

function isVersionListKey(key: string | undefined): key is VersionListKey {
	return !!key && versionListKeys.includes(key);
}

/**
 * Parses the subset of YAML used in `<!-- YAML -->` doc comments.
 */
export function parseYaml(lines: string[]): Yaml {
	const yaml: Yaml = { added: [], deprecated: [], removed: [], changes: [] };
	let key: string | undefined;
	let change: ApiChange | undefined;
	let field: string | undefined;

	for (const line of lines) {
		const top = /^([\w-]+):\s*(.*)$/.exec(line);
		if (top) {
			key = top[1];
			if (top[2] && isVersionListKey(key)) yaml[key].push(top[2]);
			continue;
		}

		if (key != 'changes') {
			const item = /^\s*-\s+(\S+)/.exec(line);
			if (item && isVersionListKey(key)) yaml[key].push(item[1]);
			continue;
		}

		const entry = /^(\s*-\s+)?(version|pr-url|description):\s*(.*)$/.exec(line.trim().startsWith('-') ? line : line.trimStart());
		if (entry) {
			if (entry[1]) yaml.changes.push((change = { versions: [], description: '' }));
			if (!change) continue;
			field = entry[2];
			const value = entry[3].trim();
			if (field == 'version' && value) change.versions.push(value);
			if (field == 'pr-url') change.pr = Number(/\/pull\/(\d+)/.exec(value)?.[1]) || undefined;
			if (field == 'description') change.description = value;
			continue;
		}

		if (!change) continue;

		const item = /^\s*-\s+(\S+)\s*$/.exec(line);
		if (item && field == 'version') {
			change.versions.push(item[1]);
			continue;
		}

		if (field == 'description') change.description += ' ' + line.trim();
	}

	return yaml;
}

const ownerPrefixes: Record<string, string | undefined> = {
	fs: 'fs',
	fsPromises: 'fsPromises',
	filehandle: 'FileHandle',
	dir: 'Dir',
	dirent: 'Dirent',
	stats: 'Stats',
	statfs: 'StatFs',
	readStream: 'ReadStream',
	writeStream: 'WriteStream',
	utf8Stream: 'Utf8Stream',
};

/**
 * Converts the expression in a doc heading into a property path.
 */
function parsePath(expression: string): (string | symbol)[] {
	return [...expression.matchAll(/\.?([\w$]+)|\[Symbol\.(\w+)\]/g)].map(match => (match[2] ? wellKnownSymbol(match[2]) : match[1]));
}

/**
 * Looks up a well-known symbol case-insensitively, returning the name as a string if there is no such symbol.
 */
function wellKnownSymbol(name: string): symbol | string {
	const key = Object.getOwnPropertyNames(Symbol).find(key => key.toLowerCase() == name.toLowerCase());
	const symbol: unknown = key && Reflect.get(Symbol, key);
	return typeof symbol == 'symbol' ? symbol : `[Symbol.${name}]`;
}

export function formatPath(path: (string | symbol)[]): string {
	return path.map((part, index) => (typeof part == 'symbol' ? `[${part.description}]` : index ? '.' + part : part)).join('');
}
