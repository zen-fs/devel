// SPDX-License-Identifier: LGPL-3.0-or-later
import { InvalidArgumentError } from 'commander';
import { homedir } from 'node:os';
import { relative } from 'node:path';
import { stripVTControlCharacters, styleText, type InspectColor } from 'node:util';
import type { PRStatus, Status } from './analysis.js';
import type { PR } from './pr.js';
import type { MarkEntry } from './state.js';

export function displayPath(path: string): string {
	const fromCwd = relative(process.cwd(), path);
	if (!fromCwd.startsWith('..')) return fromCwd || '.';
	return path.startsWith(homedir()) ? '~' + path.slice(homedir().length) : path;
}

export const statusStyles: Record<Status, InspectColor> = { pending: 'yellow', auto: 'cyan', resolved: 'green', ignored: 'gray' };

export const semverStyles: Record<PR['semver'], InspectColor> = { major: 'red', minor: 'magenta', patch: 'dim', unreleased: 'blue' };

/**
 * Creates an option parser for repeated, comma-separated values, optionally restricted to `choices`.
 */
export function parseList<const T extends string = string>(choices?: readonly T[]) {
	return (value: string, previous: T[] | undefined): T[] => {
		const values = value
			.split(',')
			.map(item => item.trim())
			.filter(Boolean);
		for (const item of values) {
			if (choices && !choices.includes(item as T)) throw new InvalidArgumentError(`Expected ${choices.join(', ')}.`);
		}
		return [...(previous ?? []), ...(values as T[])];
	};
}

export function parseIntegers(value: string, previous: number[] | undefined): number[] {
	const numbers = parseList()(value, undefined).map(Number);
	if (numbers.some(number => !Number.isSafeInteger(number))) throw new InvalidArgumentError('Expected integers.');
	return [...(previous ?? []), ...numbers];
}

export function parsePositiveInteger(value: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new InvalidArgumentError('Expected a positive integer.');
	return number;
}

/**
 * Compiles a case-insensitive pattern.
 */
export function parseRegex(source: string): RegExp {
	try {
		return new RegExp(source, 'i');
	} catch {
		throw new InvalidArgumentError('Invalid regular expression.');
	}
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
