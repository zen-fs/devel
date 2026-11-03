#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, styleText } from 'node:util';
import { configPath, saveRepo, savedRepo } from '../node_compat/config.js';
import * as core from '../node_compat/index.js';
import {
	displayPath,
	fail,
	formatMark,
	keysOf,
	list,
	pad,
	printFields,
	printPRTable,
	regex,
	semverStyles,
	statusStyles,
} from '../node_compat/output.js';

const help = {
	main: `Usage: node-compat [options] <command> [args]

Tracks Node.js \`fs:\` pull requests and API changes against @zenfs/core,
using only a local clone of the Node.js repository.

Commands:
  summary              Overview of PRs, API coverage, and pending features (default)
  prs                  List fs PRs (see \`prs --help\`)
  apis                 Compare the documented fs API surface with ZenFS
  show <id>            Details for a PR (12345, #12345, or URL) or an API (fs.glob, FileHandle#readLines)
  resolve <id...>      Mark PRs or APIs as resolved; \`-\` reads IDs from stdin
  ignore <id...>       Mark PRs or APIs as not applicable to ZenFS
  unmark <id...>       Remove marks
  marks                List marks

Options:
  --node <dir>         Node.js clone (default: $NODE_REPO, then the saved clone)
  --persist            Save --node or $NODE_REPO as the default clone
  --ref <ref>          Ref to read from (default: upstream of main, or HEAD)
  --state <file>       Marks file (default: ${core.defaultMarksPath})
  -h, --help           Show help

The first clone used is saved to ${displayPath(configPath)}.`,
	prs: `Usage: node-compat prs [filters]

By default only pending features are listed: --status pending --semver major,minor,unreleased.
Passing a filter replaces its default; --all drops the defaults.

Filters:
  --since <version>    Released in this version or later, or unreleased (default: 18)
  -k, --semver <list>  major, minor, patch, unreleased
  -s, --status <list>  pending, auto, resolved, ignored
                       (auto: every API the PR added exists in ZenFS)
  -l, --line <list>    Released in all of these release lines, e.g. 22,24
  -t, --tag <list>     Has these tags: native, internal, docs, test, windows, perf,
                       stability, deprecation, revert, backport
  -x, --exclude <list> Doesn't have these tags
  -g, --grep <regex>   Matches the title or commit messages (case-insensitive)
  -u, --unreleased     Only PRs not in any release
  -a, --all            Drop the default filters

Output:
  -n, --limit <n>      Show at most n PRs
  --ids                Print only IDs, e.g. \`prs -t windows --ids | node-compat ignore - -m Windows\`
  --exit-code          Exit with 1 if any PRs are listed`,
	apis: `Usage: node-compat apis [filters]

By default only unmarked APIs that ZenFS is missing are listed.

Filters:
  -a, --all            List every documented API
  -g, --grep <regex>   Matches the API ID (case-insensitive)
  --owner <name>       fs, fsPromises, or a class such as FileHandle
  --kind <list>        module, class, member, constant

Output:
  --ids                Print only IDs
  --exit-code          Exit with 1 if any APIs are listed`,
	mark: `Usage: node-compat <resolve | ignore | unmark> <id...> [-m <note>]

IDs can be PR numbers (12345, #12345, or URLs) or API IDs (fs.glob).
API IDs may contain * wildcards. Use \`-\` to read whitespace-separated IDs from stdin.

  -m, --message <note> Attach a note to the mark`,
};

function parseOptions() {
	try {
		return parseArgs({ options: optionConfig, allowPositionals: true });
	} catch (error) {
		fail(`${error instanceof Error ? error.message : String(error)}. See --help.`);
	}
}

const optionConfig = {
	help: { short: 'h', type: 'boolean' },
	node: { type: 'string' },
	persist: { type: 'boolean' },
	ref: { type: 'string' },
	state: { type: 'string' },
	ids: { type: 'boolean' },
	'exit-code': { type: 'boolean' },
	since: { type: 'string' },
	semver: { short: 'k', type: 'string', multiple: true },
	status: { short: 's', type: 'string', multiple: true },
	line: { short: 'l', type: 'string', multiple: true },
	tag: { short: 't', type: 'string', multiple: true },
	exclude: { short: 'x', type: 'string', multiple: true },
	grep: { short: 'g', type: 'string' },
	unreleased: { short: 'u', type: 'boolean' },
	all: { short: 'a', type: 'boolean' },
	limit: { short: 'n', type: 'string' },
	owner: { type: 'string' },
	kind: { type: 'string', multiple: true },
	message: { short: 'm', type: 'string' },
} as const;

const { values: options, positionals } = parseOptions();

const [command = 'summary', ...args] = positionals;

if (options.help) {
	const topic = command == 'prs' || command == 'apis' ? command : ['resolve', 'ignore', 'unmark'].includes(command) ? 'mark' : 'main';
	console.log(help[topic]);
	process.exit();
}

const saved = savedRepo();
const repoPath =
	options.node
	?? process.env.NODE_REPO
	?? saved
	?? fail(`No Node.js clone given. Use --node <dir> or set NODE_REPO; it will be saved to ${displayPath(configPath)}.`);

const marksPath = options.state ?? core.defaultMarksPath;
const marks: core.Marks = existsSync(marksPath) || command == 'resolve' || command == 'ignore' ? core.openMarks(marksPath) : new Map();

let node: core.NodeRepository;
try {
	node = new core.NodeRepository({ repo: repoPath, ref: options.ref });
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

if (node.path != saved && (!saved || options.persist)) {
	saveRepo(node.path);
	console.error(styleText('dim', `Saved ${displayPath(node.path)} as the Node.js clone in ${displayPath(configPath)}\n`));
}

const analysis = new core.Analysis(node, marks);

const since = options.since ?? '18';
const sinceFilter = { since, landedSince: node.releaseDate(since) } satisfies core.PRFilter;

function prFilter(): { filter: core.PRFilter; defaulted: string[] } {
	const defaulted = [];
	const filter: core.PRFilter = {
		...sinceFilter,
		semver: keysOf(list(options.semver), semverStyles, 'semver'),
		status: keysOf(list(options.status), statusStyles, 'status'),
		lines: list(options.line)?.map(Number),
		tags: [...(list(options.tag) ?? []), ...(list(options.exclude)?.map(tag => '!' + tag) ?? [])],
		grep: regex(options.grep),
		unreleased: options.unreleased,
	};

	if (!options.all) {
		if (!filter.status) {
			filter.status = ['pending'];
			defaulted.push('--status pending');
		}
		if (!filter.semver && !filter.unreleased) {
			filter.semver = ['major', 'minor', 'unreleased'];
			defaulted.push('--semver major,minor,unreleased');
		}
	}

	return { filter, defaulted };
}

function commandPRs(): void {
	const { filter, defaulted } = prFilter();
	const matched = analysis.filterPRs(filter).sort(core.byNewest);
	const limit = options.limit ? Number(options.limit) : Infinity;
	const rows = matched.slice(0, limit);

	if (options.ids) {
		for (const { pr } of rows) console.log(pr.number);
	} else {
		printPRTable(rows);
		const shown = rows.length < matched.length ? `${rows.length} of ${matched.length} matching` : `${matched.length}`;
		const notes = [`since ${filter.since}`, ...defaulted];
		const hint = defaulted.length ? '. Use --all to drop defaults.' : '';
		console.log(styleText('dim', `\n${shown} PRs (of ${analysis.prs.size}; ${notes.join(', ')})${hint}`));
	}

	if (options['exit-code'] && rows.length) process.exitCode = 1;
}

function commandApis(): void {
	const kinds = list(options.kind);
	const grep = regex(options.grep);
	const owner = options.owner?.toLowerCase();

	const rows = [...analysis.apis.values()].filter(({ api, present, mark }) => {
		if (!options.all && (present || mark)) return false;
		if (kinds && !kinds.includes(api.kind)) return false;
		if (owner && api.owner.toLowerCase() != owner) return false;
		if (grep && !grep.test(api.id)) return false;
		return true;
	});

	if (options.ids) {
		for (const { api } of rows) console.log(api.id);
	} else {
		const idWidth = Math.max(10, ...rows.map(({ api }) => api.id.length));
		const pendingPRs = new Set(analysis.filterPRs({ ...sinceFilter, status: ['pending'] }).map(({ pr }) => pr.number));
		for (const { api, present, mark } of rows) {
			const pending = api.changes.filter(change => change.pr && pendingPRs.has(change.pr)).length;
			const notes = [
				api.deprecated.length ? styleText('yellow', 'deprecated') : '',
				api.stability == 1 ? styleText('magenta', 'experimental') : '',
				pending ? styleText('yellow', `${pending} pending change${pending == 1 ? '' : 's'}`) : '',
				formatMark(mark),
			];
			console.log(
				present ? styleText('green', '✓') : styleText('red', '✗'),
				pad(api.id, idWidth),
				pad(styleText('dim', api.added.join(', ') || '-'), 18),
				notes.filter(Boolean).join(' '),
			);
		}
		const present = [...analysis.apis.values()].filter(status => status.present).length;
		const hint = options.all ? '' : ' Use --all to list every API.';
		console.log(styleText('dim', `\n${rows.length} listed; ZenFS has ${present} of ${analysis.apis.size} documented APIs.${hint}`));
	}

	if (options['exit-code'] && rows.length) process.exitCode = 1;
}

function showPR(pr: core.PR): void {
	const status = analysis.prs.get(pr.number)!;
	const apiState = (id: string): string => {
		const api = analysis.apis.get(id);
		if (!api) return styleText('dim', id);
		return (api.present ? styleText('green', '✓ ') : styleText('red', '✗ ')) + id + (api.mark ? ' ' + formatMark(api.mark) : '');
	};

	console.log(styleText('bold', `#${pr.number} ${pr.subsystems.join(',')}: ${pr.title}`));
	console.log(styleText('dim', pr.url) + '\n');

	printFields([
		['Author', pr.author],
		['Semver', styleText(semverStyles[pr.semver], pr.semver)],
		['Status', styleText(statusStyles[status.status], status.status) + (status.mark ? ' ' + formatMark(status.mark).replace(/^\S+/, '') : '')],
		[
			'Released',
			pr.releases.map(release => `${release.version} ${styleText('dim', `(${release.date})`)}`).join(', ') || styleText('blue', 'unreleased'),
		],
		[
			'Landed',
			pr.commits.length
				? `${pr.commits[0].date.slice(0, 10)} on ${node.ref} (${pr.commits.map(commit => commit.hash.slice(0, 10)).join(', ')})`
				: styleText('dim', `not on ${node.ref} (release branches only)`),
		],
		['Areas', pr.areas.join(' ')],
		['Tags', pr.tags.join(', ')],
		['Added', pr.apis.added.map(apiState).join(', ')],
		['Removed', pr.apis.removed.join(', ')],
		['Changed', pr.apis.changed.map(apiState).join(', ')],
	]);

	for (const id of pr.apis.changed) {
		const api = node.apis.get(id);
		for (const change of api?.changes.filter(change => change.pr == pr.number) ?? []) {
			console.log(styleText('dim', `\n${id} (${change.versions.join(', ')}):`), change.description);
		}
	}

	for (const commit of pr.commits) {
		const body = commit.body
			.split('\n')
			.filter(line => !/^(PR-URL|Reviewed-By|Signed-off-by|Co-authored-by|Acked-By):/i.test(line))
			.join('\n')
			.trim();
		console.log(styleText('dim', `\ncommit ${commit.hash}`));
		console.log(commit.subject + (body ? '\n\n' + body.replace(/^/gm, '    ') : ''));
	}
}

function showApi(api: core.docs.Api): void {
	const status = analysis.apis.get(api.id)!;
	console.log(styleText('bold', api.id), styleText('dim', `(${api.kind}, ${api.section})`) + '\n');

	printFields([
		['Signature', api.signatures.join('\n           ')],
		['Added', api.added.join(', ')],
		['Deprecated', api.deprecated.join(', ')],
		['Stability', api.stability === undefined ? '' : String(api.stability)],
		['ZenFS', status.present ? styleText('green', 'present') : styleText('red', 'missing')],
		['Mark', formatMark(status.mark)],
	]);

	if (!api.changes.length) return;
	console.log(styleText('bold', '\nChanges'));
	for (const change of api.changes) {
		const pr = change.pr ? analysis.prs.get(change.pr) : undefined;
		const tracked = pr ? styleText(statusStyles[pr.status], pr.status) : styleText('dim', 'untracked');
		console.log(`  ${pad(change.versions.join(', '), 24)} ${pad(change.pr ? '#' + change.pr : '', 7)} ${pad(tracked, 9)} ${change.description}`);
	}
}

function commandShow(): void {
	if (!args.length) fail('Usage: node-compat show <id>');
	for (const [index, input] of args.entries()) {
		const resolved = node.resolve(input) ?? fail(`Unknown PR or API "${input}"`);
		if (index) console.log('\n' + styleText('dim', '─'.repeat(40)) + '\n');
		if (resolved.pr) showPR(resolved.pr);
		else if (resolved.api) showApi(resolved.api);
	}
}

function readIds(): string[] {
	return args.flatMap(arg => (arg == '-' ? readFileSync(0, 'utf8').split(/\s+/).filter(Boolean) : [arg]));
}

function commandMark(mark: core.Mark | undefined): void {
	const ids = readIds();
	if (!ids.length) fail(`No IDs given. Usage: node-compat ${command} <id...>`);

	const targets: core.Resolved[] = [];
	for (const input of ids) {
		const resolved = node.resolveAll(input);
		if (!resolved.length && marks.has(input)) resolved.push({ key: input });
		if (!resolved.length) console.error(styleText('yellow', 'skipped:'), `unknown PR or API "${input}"`);
		targets.push(...resolved);
	}

	let changed = 0;
	for (const { key, pr } of targets) {
		if (mark) marks.set(key, core.createMark(mark, options.message));
		else if (!marks.delete(key)) continue;
		changed++;
		if (targets.length <= 20) {
			console.log(mark ? styleText(statusStyles[mark], mark.padEnd(8)) : styleText('dim', 'unmarked'), pr ? `${key} ${pr.title}` : key);
		}
	}

	console.log(styleText('dim', `${changed} mark${changed == 1 ? '' : 's'} updated in ${displayPath(marksPath)}`));
}

function commandMarks(): void {
	const entries = [...marks].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }));
	if (!entries.length) return console.log(styleText('dim', `No marks in ${displayPath(marksPath)}`));
	const width = Math.max(...entries.map(([key]) => key.length));
	for (const [key, { status, date, note }] of entries) {
		const pr = key.startsWith('#') ? node.prs.get(Number(key.slice(1))) : undefined;
		console.log(
			pad(key, width),
			pad(styleText(statusStyles[status], status), 8),
			styleText('dim', date),
			pr?.title ?? '',
			note ? styleText('dim', `— ${note}`) : '',
		);
	}
}

function commandSummary(): void {
	const prs = analysis.filterPRs(sinceFilter);
	const counts: Partial<Record<core.PR['semver'], Record<core.Status, number>>> = {};
	for (const { pr, status } of prs) {
		const group = (counts[pr.semver] ??= { pending: 0, auto: 0, resolved: 0, ignored: 0 });
		group[status]++;
	}

	const apis = [...analysis.apis.values()];
	const present = apis.filter(status => status.present).length;
	const missing = apis.filter(status => !status.present && !status.mark);
	const pending = analysis.filterPRs({ status: ['pending'], semver: ['major', 'minor', 'unreleased'] }, prs).sort(core.byNewest);

	const repoInfo = `(${node.hash.slice(0, 10)}, ${node.date.toISOString().slice(0, 10)}, latest release ${node.latest?.version})`;
	console.log(styleText('bold', 'Node.js'.padEnd(9)), `${displayPath(node.path)} @ ${node.ref}`, styleText('dim', repoInfo));
	console.log(styleText('bold', 'ZenFS'.padEnd(9)), core.zenfs.version);
	console.log(styleText('bold', 'Marks'.padEnd(9)), `${marks.size} in ${displayPath(marksPath)}\n`);

	console.log(styleText('bold', `PRs since ${since}`), styleText('dim', `(${prs.length})`));
	for (const semver of ['major', 'minor', 'patch', 'unreleased'] as const) {
		const group = counts[semver];
		if (!group) continue;
		const total = Object.values(group).reduce((sum, count) => sum + count, 0);
		const breakdown = (Object.keys(statusStyles) as core.Status[])
			.filter(status => group[status])
			.map(status => styleText(statusStyles[status], `${group[status]} ${status}`))
			.join(', ');
		console.log(' ', pad(styleText(semverStyles[semver], semver), 11), String(total).padStart(4), ' ', breakdown);
	}

	console.log(styleText('bold', '\nAPIs'), styleText('dim', `(${apis.length} documented)`));
	console.log(`  ${present} present (${Math.floor((present / apis.length) * 100)}%), ${missing.length} missing and unmarked`);
	if (missing.length) console.log(styleText('red', '  ' + missing.map(({ api }) => api.id).join(', ')));

	if (pending.length) {
		console.log(styleText('bold', '\nPending features'), styleText('dim', `(${pending.length})`));
		printPRTable(pending.slice(0, 15));
		if (pending.length > 15) console.log(styleText('dim', `  … ${pending.length - 15} more`));
	}

	console.log(styleText('dim', '\n`prs` lists PRs, `show <id>` shows details, `resolve`/`ignore` mark them. See --help.'));
}

switch (command) {
	case 'summary':
		commandSummary();
		break;
	case 'prs':
	case 'list':
		commandPRs();
		break;
	case 'apis':
		commandApis();
		break;
	case 'show':
		commandShow();
		break;
	case 'resolve':
		commandMark('resolved');
		break;
	case 'ignore':
		commandMark('ignored');
		break;
	case 'unmark':
		commandMark(undefined);
		break;
	case 'marks':
		commandMarks();
		break;
	default:
		fail(`Unknown command "${command}". See --help.`);
}
