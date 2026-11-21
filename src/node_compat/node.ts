// SPDX-License-Identifier: LGPL-3.0-or-later
import * as changelog from './changelog.js';
import { matchesSubsystem, readApiHistory, readCommits } from './commits.js';
import * as docs from './docs.js';
import { Repository } from './git.js';
import { PR } from './pr.js';
import * as semver from 'semver';

export interface NodeRepositoryInit {
	/** Path to a Node.js clone */
	repo: string;
	/** Git ref to read history, changelogs, and docs from */
	ref?: string;
	subsystems?: string[];
	/** Docs file within the Node.js repository */
	docs?: string;
}

export interface Resolved {
	/** Key for marks */
	key: string;
	pr?: PR;
	api?: docs.Api;
}

export class NodeRepository extends Repository {
	readonly prs = new Map<number, PR>();

	readonly apis = new Map<string, docs.Api>();

	/** Every release found in the changelogs, newest first */
	readonly releases: changelog.Release[] = [];

	/** ISO date of each release line's first release */
	private readonly lineStarts = new Map<number, string>();

	private readonly releaseDates = new Map<string, string>();

	/**
	 * Loads PRs, releases, and the API surface from a local Node.js clone.
	 */
	constructor({ subsystems = ['fs'], docs: docPath = docs.fs, ...options }: NodeRepositoryInit) {
		super(options.repo, options.ref);

		const commits = readCommits(this, subsystems);
		const history = readApiHistory(this, docPath, new Set(commits.map(commit => commit.hash)));

		const getPR = (number: number): PR => {
			let pr = this.prs.get(number);
			if (!pr) this.prs.set(number, (pr = new PR(number)));
			return pr;
		};

		for (const commit of commits.toReversed()) {
			const number = Number(/^PR-URL: https:\/\/github\.com\/nodejs\/node\/pull\/(\d+)/m.exec(commit.body)?.[1]);
			if (number) getPR(number).addCommit(commit, history.get(commit.hash));
		}

		const releases = new Map<string, changelog.Release>();
		for (const entry of changelog.read(this)) {
			releases.set(entry.release.version, entry.release);
			if (matchesSubsystem(entry.subsystems, subsystems) || this.prs.has(entry.pr)) getPR(entry.pr).addRelease(entry);
		}

		for (const api of docs.Api.read(this, docPath).values()) {
			this.apis.set(api.id, api);
			for (const change of api.changes) {
				const pr = change.pr && this.prs.get(change.pr);
				if (pr && !pr.apis.changed.includes(api.id)) pr.apis.changed.push(api.id);
			}
		}

		this.releases = [...releases.values()].sort((left, right) => semver.rcompare(left.version, right.version));
		for (const release of this.releases.toReversed()) {
			this.releaseDates.set(release.version, release.date);
			if (!this.lineStarts.has(release.line)) this.lineStarts.set(release.line, release.date);
		}
	}

	get latest(): changelog.Release | undefined {
		return this.releases[0];
	}

	/**
	 * Whether a change released in any of `versions` is part of `target`.
	 * Releases from older lines count if they came out before the target's line started.
	 * @param versions Versions, optionally prefixed with `v`
	 */
	releaseIncludes(target: string, versions: string[]): boolean {
		const line = semver.major(target);
		const lineStart = this.lineStarts.get(line);
		return versions.some(input => {
			const version = semver.valid(input);
			if (!version) return false;
			const major = semver.major(version);
			if (major == line) return semver.lte(version, target);
			if (major > line || !lineStart) return false;
			const date = this.releaseDates.get(version);
			return !date || date <= lineStart;
		});
	}

	/**
	 * Date of the first release at or after a version.
	 */
	releaseDate(version: string): string | undefined {
		return this.releases.filter(release => semver.gte(release.version, version)).at(-1)?.date;
	}

	/**
	 * Resolves a PR number, `#number`, PR URL, or case-insensitive API ID.
	 */
	resolve(input: string): Resolved | undefined {
		const number = Number(/^(?:#|.*\/pull\/)?(\d+)\/?$/.exec(input.trim())?.[1]);
		if (number) {
			const pr = this.prs.get(number);
			return pr && { key: pr.key, pr };
		}

		const name = input.trim().replace(/\(.*\)$/, '');
		const api = this.apis.get(name) ?? [...this.apis.values()].find(api => api.id.toLowerCase() == name.toLowerCase());
		return api && { key: api.id, api };
	}

	/**
	 * Like `resolve`, but API IDs may contain `*` wildcards.
	 */
	resolveAll(input: string): Resolved[] {
		if (!input.includes('*')) {
			const resolved = this.resolve(input);
			return resolved ? [resolved] : [];
		}
		const source = input
			.trim()
			.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
			.replaceAll('*', '.*');
		const pattern = new RegExp(`^${source}$`, 'i');
		return [...this.apis.values()].filter(api => pattern.test(api.id)).map(api => ({ key: api.id, api }));
	}
}
