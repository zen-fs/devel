// SPDX-License-Identifier: LGPL-3.0-or-later
import { homedir } from 'node:os';
import { relative } from 'node:path';
import { stripVTControlCharacters, styleText, type InspectColor } from 'node:util';
import type { PRStatus, Status } from './analysis.js';
import type { PR } from './pr.js';
import type { MarkEntry } from './state.js';

export function fail(message: string): never {
	console.error(styleText('red', 'error:'), message);
	process.exit(1);
}

export function displayPath(path: string): string {
	const fromCwd = relative(process.cwd(), path);
	if (!fromCwd.startsWith('..')) return fromCwd || '.';
	return path.startsWith(homedir()) ? '~' + path.slice(homedir().length) : path;
}

/**
 * Flattens repeated and comma-separated option values.
 */
export function list(values: string[] | undefined): string[] | undefined {
	return values
		?.flatMap(value => value.split(','))
		.map(value => value.trim())
		.filter(Boolean);
}

/**
 * Compiles a case-insensitive pattern, exiting if it is invalid.
 */
export function regex(source: string | undefined): RegExp | undefined {
	if (!source) return;
	try {
		return new RegExp(source, 'i');
	} catch {
		fail(`Invalid regular expression: ${source}`);
	}
}

export const statusStyles: Record<Status, InspectColor> = { pending: 'yellow', auto: 'cyan', resolved: 'green', ignored: 'gray' };

export const semverStyles: Record<PR['semver'], InspectColor> = { major: 'red', minor: 'magenta', patch: 'dim', unreleased: 'blue' };

/**
 * Exits unless every value is a key of `styles`.
 */
export function keysOf<const K extends string>(values: string[] | undefined, styles: Record<K, InspectColor>, label: string): K[] | undefined {
	for (const value of values ?? []) {
		if (!Object.hasOwn(styles, value)) fail(`Unknown ${label} "${value}" (expected ${Object.keys(styles).join(', ')})`);
	}
	return values as K[] | undefined;
}

/**
 * Pads text containing ANSI escapes to a visible width.
 */
export function pad(text: string, width: number): string {
	return text + ' '.repeat(Math.max(0, width - stripVTControlCharacters(text).length));
}

/**
 * Shortens text to `width` when writing to a terminal.
 */
export function truncate(text: string, width: number): string {
	if (!process.stdout.isTTY || text.length <= width) return text;
	return text.slice(0, Math.max(0, width - 1)) + '…';
}

export function formatVersions(versions: string[]): string {
	return versions.join(', ') || styleText('blue', 'unreleased');
}

export function formatMark(mark: MarkEntry | undefined): string {
	if (!mark) return '';
	return styleText(statusStyles[mark.status], mark.status) + styleText('dim', ` ${mark.date}`) + (mark.note ? ` — ${mark.note}` : '');
}

export function printFields(fields: [label: string, value: string][]): void {
	for (const [label, value] of fields) if (value) console.log(styleText('bold', label.padEnd(10)), value);
}

export function printPRTable(rows: PRStatus[]): void {
	const versionWidth = Math.min(28, Math.max(10, ...rows.map(({ pr }) => formatVersions(pr.versions).length)));
	const width = process.stdout.columns ?? Infinity;

	for (const { pr, status, missing } of rows) {
		const tags = pr.tags.length ? styleText('dim', ` [${pr.tags.join(', ')}]`) : '';
		const extra = missing.length ? styleText('red', ` missing: ${missing.join(', ')}`) : '';
		const prefix = [
			pad(styleText('bold', '#' + pr.number), 7),
			pad(styleText(semverStyles[pr.semver], pr.semver), 10),
			pad(styleText(statusStyles[status], status), 8),
			pad(truncate(formatVersions(pr.versions), versionWidth), versionWidth),
		].join(' ');
		const fixed = 7 + 10 + 8 + versionWidth + 4;
		console.log(prefix, truncate(pr.title, width - fixed) + tags + extra);
	}
}
