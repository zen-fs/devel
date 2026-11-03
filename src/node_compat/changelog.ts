// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Repository } from './git.js';
import { parseVersion } from './versions.js';

export type Semver = 'major' | 'minor' | 'patch';

export interface Release {
	version: string;
	/** Major version */
	line: number;
	/** ISO date */
	date: string;
}

export interface Entry {
	pr: number;
	/** Abbreviated hash on the release branch */
	commit: string;
	subsystems: string[];
	title: string;
	author: string;
	semver: Semver;
	revert: boolean;
	release: Release;
}

const releaseHeading = /^## (?<date>\d{4}-\d{2}-\d{2}), Version (?<version>\d+\.\d+\.\d+)/;
const changelogLine =
	/^\* \\\[\[`(?<commit>[0-9a-f]+)`\]\([^)]*\)\] - (?<rest>.+?)\s*\[#(?<pr>\d+)\]\(https:\/\/github\.com\/nodejs\/node\/pull\/\d+\)\s*$/;

/**
 * Parses the commit lines of a changelog, including the duplicates listed under notable changes.
 */
export function parse(text: string): Entry[] {
	const entries: Entry[] = [];
	let release: Release | undefined;

	for (const line of text.split('\n')) {
		const heading = releaseHeading.exec(line);
		if (heading?.groups) {
			const { date, version } = heading.groups;
			release = { version, line: parseVersion(version)[0], date };
			continue;
		}

		const match = release && changelogLine.exec(line);
		if (!release || !match?.groups) continue;

		let rest = match.groups.rest;
		let semver: Semver = 'patch';
		for (let tag; (tag = /^\*\*\((?<tag>[^)]+)\)\*\*\s*/.exec(rest)); rest = rest.slice(tag[0].length)) {
			if (tag.groups?.tag == 'SEMVER-MAJOR') semver = 'major';
			if (tag.groups?.tag == 'SEMVER-MINOR' && semver != 'major') semver = 'minor';
		}

		const revert = /^_\*\*Revert\*\*_ "/.test(rest);
		if (revert) rest = rest.replace(/^_\*\*Revert\*\*_ "/, '');

		const subject = /^\*\*(?<subsystems>[^*]+)\*\*: (?<text>.*)$/.exec(rest);
		if (!subject?.groups) continue;

		let { text: title } = subject.groups;
		let author = '';
		const authorStart = title.lastIndexOf(' (');
		if (authorStart != -1 && title.endsWith(')')) {
			author = title.slice(authorStart + 2, -1);
			title = title.slice(0, authorStart);
		}
		if (revert) title = title.replace(/"$/, '');

		entries.push({
			pr: Number(match.groups.pr),
			commit: match.groups.commit,
			subsystems: subject.groups.subsystems.split(',').map(name => name.trim()),
			title,
			author,
			semver,
			revert,
			release,
		});
	}

	return entries;
}

export function read(repo: Repository): Entry[] {
	const listing = repo.git(['ls-tree', repo.ref, 'doc/changelogs/']);
	const hashes = [...listing.matchAll(/^\S+ blob (\S+)\tdoc\/changelogs\/CHANGELOG_V\d+\.md$/gm)].map(match => match[1]);
	return [...repo.readBlobs(hashes).values()].flatMap(parse);
}
