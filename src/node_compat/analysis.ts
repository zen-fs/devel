// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as changelog from './changelog.js';
import type { Api } from './docs.js';
import type { NodeRepository } from './node.js';
import type { PR } from './pr.js';
import type { MarkEntry, Marks } from './state.js';
import { compareVersions, isVersion } from './versions.js';
import * as zenfs from './zenfs.js';

/**
 * `auto` means every API the PR added exists in ZenFS.
 */
export type Status = 'pending' | 'resolved' | 'ignored' | 'auto';

export interface ApiStatus {
	api: Api;
	present: boolean;
	mark?: MarkEntry;
}

export interface PRStatus {
	pr: PR;
	status: Status;
	mark?: MarkEntry;
	/** Affected APIs that ZenFS lacks */
	missing: string[];
}

export interface PRFilter {
	/** Include PRs released in this version or later */
	since?: string;
	/** Include unreleased PRs that landed on or after this ISO date */
	landedSince?: string;
	semver?: PR['semver'][];
	status?: Status[];
	/** Release lines the PR must have been released in */
	lines?: number[];
	/** Tags the PR must have; prefix with `!` to exclude */
	tags?: string[];
	/** Matched against the title and commit messages */
	grep?: RegExp;
	/** Only PRs not in any release */
	unreleased?: boolean;
}

/**
 * Combines Node.js data, the ZenFS probe, and manual marks.
 */
export class Analysis {
	readonly apis = new Map<string, ApiStatus>();
	readonly prs = new Map<number, PRStatus>();

	constructor(
		readonly node: NodeRepository,
		marks: Marks,
	) {
		const snapshot: Marks = new Map(marks);

		for (const api of node.apis.values()) {
			this.apis.set(api.id, { api, present: zenfs.has(api), mark: snapshot.get(api.id) });
		}

		for (const pr of node.prs.values()) {
			const mark = snapshot.get(pr.key);
			const missing = [...pr.apis.added, ...pr.apis.changed].filter(id => {
				const status = this.apis.get(id);
				return status && !status.present && !status.mark;
			});
			const auto = pr.apis.added.length > 0 && pr.apis.added.every(id => this.apis.get(id)?.present);
			this.prs.set(pr.number, { pr, mark, missing, status: mark?.status ?? (auto ? 'auto' : 'pending') });
		}
	}

	/**
	 * @param prs Defaults to every PR
	 */
	filterPRs(filter: PRFilter, prs: Iterable<PRStatus> = this.prs.values()): PRStatus[] {
		const { since, landedSince, grep } = filter;
		return [...prs].filter(({ pr, status }) => {
			if (filter.unreleased && pr.releases.length) return false;
			if (since && pr.releases.length && !pr.releases.some(release => compareVersions(release.version, since) >= 0)) return false;
			if (landedSince && !pr.releases.length && (pr.commits[0]?.date ?? '') < landedSince) return false;
			if (filter.semver && !filter.semver.includes(pr.semver)) return false;
			if (filter.status && !filter.status.includes(status)) return false;
			if (filter.lines && !filter.lines.every(line => pr.releases.some(release => release.line == line))) return false;
			const { tags } = pr;
			for (const tag of filter.tags ?? []) {
				if (tag.startsWith('!') ? tags.includes(tag.slice(1)) : !tags.includes(tag)) return false;
			}
			if (grep && !grep.test(pr.title) && !pr.commits.some(commit => grep.test(commit.body))) return false;
			return true;
		});
	}

	/**
	 * PRs and APIs that are part of a release, including those released earlier.
	 * API availability comes from the docs' `added` and `removed` versions, so APIs without an `added` version are always included.
	 */
	coverage(version: string): Coverage | undefined {
		const release = this.node.releases.find(release => release.version == version.replace(/^v/, ''));
		if (!release) return;

		const prs = [...this.prs.values()].filter(({ pr }) =>
			this.node.releaseIncludes(
				release.version,
				pr.releases.map(release => release.version),
			),
		);
		const apis = [...this.apis.values()].filter(({ api }) => {
			const added = api.added.filter(isVersion);
			return (!added.length || this.node.releaseIncludes(release.version, added)) && !this.node.releaseIncludes(release.version, api.removed);
		});
		const pending = prs.filter(({ status }) => status == 'pending');
		const missing = apis.filter(({ present, mark }) => !present && !mark);
		return { release, prs, apis, pending, missing, complete: !pending.length && !missing.length };
	}

	/**
	 * The newest release with every PR and API covered.
	 * @param latest Only consider this release and older ones
	 */
	lastComplete(latest?: string): Coverage | undefined {
		for (const { version } of this.node.releases) {
			if (latest && compareVersions(version, latest) > 0) continue;
			const coverage = this.coverage(version);
			if (coverage?.complete) return coverage;
		}
	}
}

export interface Coverage {
	release: changelog.Release;
	/** Every PR that is part of the release */
	prs: PRStatus[];
	/** Every API documented for the release */
	apis: ApiStatus[];
	pending: PRStatus[];
	/** APIs ZenFS lacks that are not marked */
	missing: ApiStatus[];
	complete: boolean;
}

/**
 * Sorts newest first, by landing date on the tracked ref or by first release.
 */
export function byNewest(left: PRStatus, right: PRStatus): number {
	return right.pr.date.localeCompare(left.pr.date) || right.pr.number - left.pr.number;
}
