// SPDX-License-Identifier: LGPL-3.0-or-later
import { JSONFileMap } from 'utilium/fs';

export type Mark = 'resolved' | 'ignored';

export type MarkEntry = {
	status: Mark;
	note?: string;
	/** ISO date */
	date: string;
};

/**
 * Manual marks on PRs (`#<number>`) and APIs (by ID), backed by a JSON file.
 */
export type Marks = Map<string, MarkEntry>;

export const defaultMarksPath = 'node-compat.json';

/**
 * Opens a marks file, creating it if needed.
 */
export function openMarks(path: string = defaultMarksPath): JSONFileMap<MarkEntry> {
	return new JSONFileMap<MarkEntry>(path, { overwrite_invalid: false, pretty: true });
}

export function createMark(status: Mark, note?: string): MarkEntry {
	return { status, ...(note && { note }), date: new Date().toISOString().slice(0, 10) };
}
