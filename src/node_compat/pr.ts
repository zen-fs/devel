// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as changelog from './changelog.js';
import { parseSubject, type ApiHistory, type Commit } from './commits.js';
import { compareVersions } from './versions.js';

export interface AffectedApis {
	added: string[];
	removed: string[];
	changed: string[];
}

export class PR {
	title = '';
	subsystems: string[] = [];
	author = '';
	semver: changelog.Semver | 'unreleased' = 'unreleased';
	revert = false;
	/** Commits on the tracked ref, oldest first */
	readonly commits: Commit[] = [];
	/** Every release that lists the PR, ascending */
	readonly releases: changelog.Release[] = [];
	/** Affected APIs, by ID */
	readonly apis: AffectedApis = { added: [], removed: [], changed: [] };

	constructor(readonly number: number) {}

	get url(): string {
		return `https://github.com/nodejs/node/pull/${this.number}`;
	}

	/** Key for marks */
	get key(): string {
		return '#' + this.number;
	}

	/** Earliest version in each release line, ascending */
	get versions(): string[] {
		const earliest = new Map<number, string>();
		for (const release of this.releases) if (!earliest.has(release.line)) earliest.set(release.line, release.version);
		return [...earliest.values()];
	}

	/** Top-level directories touched */
	get areas(): string[] {
		return [...new Set(this.commits.flatMap(commit => commit.files.map(file => file.split('/')[0])))].sort();
	}

	/** Heuristic labels derived from the title and touched areas */
	get tags(): string[] {
		const tags = [];
		const title = this.title.toLowerCase();
		const { areas } = this;
		if (this.revert) tags.push('revert');
		if (!this.commits.length) tags.push('backport');
		if (areas.length) {
			if (!areas.includes('lib')) tags.push(areas.includes('src') ? 'native' : areas.every(area => area == 'doc') ? 'docs' : 'internal');
			if (areas.every(area => area == 'test' || area == 'doc')) tags.push('test');
		}
		if (/\bwin(dows|32)?\b/.test(title) || this.subsystems.includes('win')) tags.push('windows');
		if (/\b(perf|performance|faster|optimi[sz]e|speed up|allocations?)\b/.test(title)) tags.push('perf');
		if (/\b(experimental|stabilize|stable)\b/.test(title)) tags.push('stability');
		if (/\b(deprecat|eol|end-of-life)/.test(title)) tags.push('deprecation');
		return tags;
	}

	/** ISO date the PR landed on the tracked ref, or of its first release */
	get date(): string {
		return this.commits[0]?.date ?? this.releases[0]?.date ?? '';
	}

	/**
	 * Adds a commit in chronological order, along with the APIs it added or removed.
	 */
	addCommit(commit: Commit, history?: ApiHistory): void {
		this.commits.push(commit);

		const subject = parseSubject(commit.subject);
		if (!this.title && subject) {
			this.title = subject.title;
			this.subsystems = subject.subsystems;
			this.revert = subject.revert;
			this.author = commit.author;
		}

		for (const id of history?.added ?? []) toggle(this.apis.added, this.apis.removed, id);
		for (const id of history?.removed ?? []) toggle(this.apis.removed, this.apis.added, id);
	}

	addRelease(entry: changelog.Entry): void {
		if (!this.releases.some(release => release.version == entry.release.version)) {
			this.releases.push(entry.release);
			this.releases.sort((left, right) => compareVersions(left.version, right.version));
		}

		if (this.semver == 'unreleased' || entry.semver == 'major' || (entry.semver == 'minor' && this.semver == 'patch')) this.semver = entry.semver;

		if (this.title) return;
		this.title = entry.title;
		this.subsystems = entry.subsystems;
		this.revert = entry.revert;
		this.author = entry.author;
	}

	toJSON() {
		return {
			number: this.number,
			url: this.url,
			title: this.title,
			subsystems: this.subsystems,
			author: this.author,
			semver: this.semver,
			revert: this.revert,
			commits: this.commits.map(({ hash, date, author, subject, files }) => ({ hash, date, author, subject, files })),
			releases: this.releases,
			versions: this.versions,
			areas: this.areas,
			tags: this.tags,
			apis: this.apis,
		};
	}
}

/**
 * Adds `id` to `target`, unless it is in `opposite`, in which case the two cancel out.
 */
function toggle(target: string[], opposite: string[], id: string): void {
	const index = opposite.indexOf(id);
	if (index != -1) opposite.splice(index, 1);
	else if (!target.includes(id)) target.push(id);
}
