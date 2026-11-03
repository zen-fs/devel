// SPDX-License-Identifier: LGPL-3.0-or-later
import { Api } from './docs.js';
import type { Repository } from './git.js';

const subjectPattern = /^(?<revert>Revert ")?(?:\[v\d+\.x\]\s*)?(?<subsystems>[\w./-]+(?:,\s?[\w./-]+)*): (?<title>.+?)"?$/;

export interface Subject {
	revert: boolean;
	subsystems: string[];
	title: string;
}

export function parseSubject(subject: string): Subject | undefined {
	const match = subjectPattern.exec(subject);
	if (!match?.groups) return;
	const { revert, subsystems, title } = match.groups;
	return { revert: !!revert, subsystems: subsystems.split(',').map(name => name.trim()), title };
}

export function matchesSubsystem(subsystems: string[], wanted: string[]): boolean {
	return subsystems.some(name => wanted.some(want => name == want || name.startsWith(want + '/')));
}

export interface Commit {
	hash: string;
	/** ISO date */
	date: string;
	author: string;
	subject: string;
	body: string;
	files: string[];
}

export function readCommits(repo: Repository, subsystems: string[]): Commit[] {
	const commits: Commit[] = [];

	for (const record of repo.git(['log', repo.ref, '--format=%x1e%H%x1f%cI%x1f%an%x1f%s%x1f%b']).split('\x1e')) {
		if (!record) continue;
		const [hash, date, author, subject, body] = record.split('\x1f');
		const parsed = parseSubject(subject);
		if (!parsed || !matchesSubsystem(parsed.subsystems, subsystems)) continue;
		commits.push({ hash, date, author, subject, body: body.trim(), files: [] });
	}

	if (!commits.length) return commits;

	const byHash = new Map(commits.map(commit => [commit.hash, commit]));
	const hashes = commits.map(commit => commit.hash).join('\n');
	for (const record of repo.git(['log', '--no-walk=unsorted', '--stdin', '--format=%x1e%H', '--name-only'], hashes).split('\x1e')) {
		const [hash, ...files] = record.trim().split('\n');
		const commit = byHash.get(hash);
		if (commit) commit.files = files.filter(Boolean);
	}

	return commits;
}

export interface ApiHistory {
	added: string[];
	removed: string[];
}

/**
 * Finds which APIs each commit added or removed by diffing the parsed docs before and after it.
 */
export function readApiHistory(repo: Repository, docs: string, hashes: Set<string>): Map<string, ApiHistory> {
	const changes: { hash: string; before: string; after: string }[] = [];

	for (const record of repo.git(['log', repo.ref, '--format=%x1e%H', '--raw', '--no-abbrev', '--', docs]).split('\x1e')) {
		const [hash, raw] = record.split('\n').filter(Boolean);
		if (!hashes.has(hash) || !raw) continue;
		const [, , before, after] = raw.split(/\s+/);
		changes.push({ hash, before, after });
	}

	const blobs = repo.readBlobs([...new Set(changes.flatMap(change => [change.before, change.after]))]);
	const parsed = new Map<string, Set<string>>();
	function idsOf(blob: string): Set<string> {
		let ids = parsed.get(blob);
		if (!ids) parsed.set(blob, (ids = new Set(Api.parse(blobs.get(blob) ?? '').keys())));
		return ids;
	}

	const history = new Map<string, ApiHistory>();
	for (const { hash, before, after } of changes) {
		const old = idsOf(before),
			current = idsOf(after);
		history.set(hash, {
			added: [...current].filter(id => !old.has(id)),
			removed: [...old].filter(id => !current.has(id)),
		});
	}
	return history;
}
