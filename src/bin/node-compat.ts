#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { Argument, Command, Option } from 'commander';
import { existsSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { styleText } from 'node:util';
import { configPath, saveRepo, savedRepo } from '../node_compat/config.js';
import * as core from '../node_compat/index.js';
import {
	displayPath,
	formatMark,
	pad,
	parseIntegers,
	parseList,
	parsePositiveInteger,
	parseRegex,
	printFields,
	printPRTable,
	semverStyles,
	statusStyles,
} from '../node_compat/output.js';

const statuses = Object.keys(statusStyles) as core.Status[];
const semvers = Object.keys(semverStyles) as core.PR['semver'][];
const tags = ['native', 'internal', 'docs', 'test', 'windows', 'perf', 'stability', 'deprecation', 'revert', 'backport'] as const;
const kinds = ['module', 'class', 'member', 'constant'] as const satisfies core.docs.ApiKind[];

const cli = new Command('node-compat')
	.description('Tracks Node.js `fs:` pull requests and API changes against @zenfs/core, using only a local clone of the Node.js repository')
	.addOption(new Option('--node <dir>', 'Node.js clone (default: the saved clone)').env('NODE_REPO'))
	.option('--persist', 'Save --node or $NODE_REPO as the default clone')
	.option('--ref <ref>', 'Ref to read from (default: upstream of main, or HEAD)')
	.option('--state <file>', 'Marks file', core.defaultMarksPath)
	.addHelpText('after', `\nThe first clone used is saved to ${displayPath(configPath)}.`);

const sinceOption = new Option('--since <version>', 'Released in this version or later, or unreleased').default('4');

interface Context {
	node: core.NodeRepository;
	analysis: core.Analysis;
	marks: core.Marks;
}

/**
 * Loads the Node.js clone and marks, saving the clone if it is the first one used.
 */
function load(createMarks: boolean = false): Context {
	const options = cli.opts();

	const saved = savedRepo();
	const repo =
		options.node
		?? saved
		?? cli.error(`error: No Node.js clone given. Use --node <dir> or set NODE_REPO; it will be saved to ${displayPath(configPath)}.`);

	const marks: core.Marks = createMarks || existsSync(options.state) ? core.openMarks(options.state) : new Map();

	let node: core.NodeRepository;
	try {
		node = new core.NodeRepository({ repo, ref: options.ref });
	} catch (error) {
		return cli.error(`error: ${Error.isError(error) ? error.message : String(error)}`);
	}

	if (node.path != saved && (!saved || options.persist)) {
		saveRepo(node.path);
		console.error(styleText('dim', `Saved ${displayPath(node.path)} as the Node.js clone in ${displayPath(configPath)}\n`));
	}

	return { node, marks, analysis: new core.Analysis(node, marks) };
}

function sinceFilter(node: core.NodeRepository, since: string): core.PRFilter {
	return { since, landedSince: node.releaseDate(since) };
}

cli.command('summary', { isDefault: true })
	.description('Overview of PRs, API coverage, and pending features')
	.addOption(sinceOption)
	.action(({ since }) => {
		const { node, analysis, marks } = load();

		const prs = analysis.filterPRs(sinceFilter(node, since));
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
		console.log(styleText('bold', 'Marks'.padEnd(9)), `${marks.size} in ${displayPath(cli.opts().state)}\n`);

		console.log(styleText('bold', since == '4' ? 'PRs' : `PRs since ${since}`), styleText('dim', `(${prs.length})`));
		for (const semver of semvers) {
			const group = counts[semver];
			if (!group) continue;
			const total = Object.values(group).reduce((sum, count) => sum + count, 0);
			const breakdown = statuses
				.filter(status => group[status])
				.map(status => styleText(statusStyles[status], `${group[status]} ${status}`))
				.join(', ');
			console.log(' ', pad(styleText(semverStyles[semver], semver), 11), String(total).padStart(4), ' ', breakdown);
		}

		const compatPercent = Math.floor((present / apis.length) * 100);
		console.log(
			styleText('bold', '\nAPI compatibility:'),
			present + '/' + apis.length,
			`(${styleText(['bold', compatPercent == 100 ? 'green' : 'yellow'], compatPercent + '%')})`,
		);

		if (missing.length) {
			console.log(styleText('bold', 'Missing APIs:'));
			for (const { api } of missing) console.log('   ', styleText('red', api.id));
		}

		if (pending.length) {
			console.log(styleText('bold', '\nPending features'), styleText('dim', `(${pending.length})`));
			printPRTable(pending.slice(0, 15));
			if (pending.length > 15) console.log(styleText('dim', `  … ${pending.length - 15} more`));
		}
	});

cli.command('prs')
	.alias('list')
	.description('List fs PRs')
	.optionsGroup('Filters:')
	.addOption(sinceOption)
	.option('-k, --semver <list>', `Any of: ${semvers.join(', ')}`, parseList(semvers))
	.option('-s, --status <list>', `Any of: ${statuses.join(', ')} (auto: every API the PR added exists in ZenFS)`, parseList(statuses))
	.option('-l, --line <list>', 'Released in all of these release lines', parseIntegers)
	.option('-t, --tag <list>', `Has all of these tags: ${tags.join(', ')}`, parseList(tags))
	.option('-x, --exclude <list>', "Doesn't have any of these tags", parseList(tags))
	.option('-g, --grep <regex>', 'Matches the title or commit messages (case-insensitive)', parseRegex)
	.option('-u, --unreleased', 'Only PRs not in any release')
	.option('-a, --all', 'Drop the default filters')
	.optionsGroup('Output:')
	.option('-n, --limit <n>', 'Show at most n PRs', parsePositiveInteger)
	.option('--ids', 'Print only IDs')
	.option('--exit-code', 'Exit with 1 if any PRs are listed')
	.addHelpText(
		'after',
		`
By default only pending features are listed: --status pending --semver major,minor,unreleased.
Passing a filter replaces its default; --all drops the defaults.

Example: node-compat prs -t windows --ids | node-compat ignore - -m Windows`,
	)
	.action(options => {
		const { node, analysis } = load();

		const defaulted = [];
		const filter: core.PRFilter = {
			...sinceFilter(node, options.since),
			semver: options.semver,
			status: options.status,
			lines: options.line,
			tags: [...(options.tag ?? []), ...(options.exclude ?? []).map(tag => '!' + tag)],
			grep: options.grep,
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

		const matched = analysis.filterPRs(filter).sort(core.byNewest);
		const rows = matched.slice(0, options.limit);

		if (options.ids) {
			for (const { pr } of rows) console.log(pr.number);
		} else {
			printPRTable(rows);
			const shown = rows.length < matched.length ? `${rows.length} of ${matched.length} matching` : `${matched.length}`;
			const notes = [`since ${options.since}`, ...defaulted];
			const hint = defaulted.length ? '. Use --all to drop defaults.' : '';
			console.log(styleText('dim', `\n${shown} PRs (of ${analysis.prs.size}; ${notes.join(', ')})${hint}`));
		}

		if (options.exitCode && rows.length) process.exitCode = 1;
	});

cli.command('apis')
	.description('Compare the documented fs API surface with ZenFS; by default only unmarked APIs that ZenFS is missing are listed')
	.optionsGroup('Filters:')
	.option('-a, --all', 'List every documented API')
	.option('-g, --grep <regex>', 'Matches the API ID (case-insensitive)', parseRegex)
	.option('--owner <name>', 'fs, fsPromises, or a class such as FileHandle')
	.option('--kind <list>', `Any of: ${kinds.join(', ')}`, parseList(kinds))
	.addOption(sinceOption)
	.optionsGroup('Output:')
	.option('--ids', 'Print only IDs')
	.option('--exit-code', 'Exit with 1 if any APIs are listed')
	.action(options => {
		const { node, analysis } = load();
		const owner = options.owner?.toLowerCase();

		const rows = [...analysis.apis.values()].filter(({ api, present, mark }) => {
			if (!options.all && (present || mark)) return false;
			if (options.kind && !options.kind.includes(api.kind)) return false;
			if (owner && api.owner.toLowerCase() != owner) return false;
			if (options.grep && !options.grep.test(api.id)) return false;
			return true;
		});

		if (options.ids) {
			for (const { api } of rows) console.log(api.id);
		} else {
			const idWidth = Math.max(10, ...rows.map(({ api }) => api.id.length));
			const pendingPRs = new Set(analysis.filterPRs({ ...sinceFilter(node, options.since), status: ['pending'] }).map(({ pr }) => pr.number));
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

		if (options.exitCode && rows.length) process.exitCode = 1;
	});

function showPR({ node, analysis }: Context, pr: core.PR): void {
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

function showApi({ analysis }: Context, api: core.docs.Api): void {
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

cli.command('show')
	.description('Details for PRs or APIs')
	.argument('<ids...>', 'PR numbers (12345, #12345, or URLs) or API IDs (fs.glob, FileHandle#readLines)')
	.action(ids => {
		const context = load();
		for (const [index, input] of ids.entries()) {
			const resolved = context.node.resolve(input) ?? cli.error(`error: Unknown PR or API "${input}"`);
			if (index) console.log('\n' + styleText('dim', '─'.repeat(40)) + '\n');
			if (resolved.pr) showPR(context, resolved.pr);
			else if (resolved.api) showApi(context, resolved.api);
		}
	});

/**
 * Applies or removes a mark, reading IDs from stdin for `-`.
 */
async function mark(status: core.Mark | undefined, inputs: string[], note?: string): Promise<void> {
	const { node, marks } = load(!!status);

	const stdin = inputs.includes('-') ? (await text(process.stdin)).split(/\s+/).filter(Boolean) : [];
	const ids = inputs.flatMap(input => (input == '-' ? stdin : [input]));

	const targets: core.Resolved[] = [];
	for (const input of ids) {
		const resolved = node.resolveAll(input);
		if (!resolved.length && marks.has(input)) resolved.push({ key: input });
		if (!resolved.length) console.error(styleText('yellow', 'skipped:'), `unknown PR or API "${input}"`);
		targets.push(...resolved);
	}

	let changed = 0;
	for (const { key, pr } of targets) {
		if (status) marks.set(key, core.createMark(status, note));
		else if (!marks.delete(key)) continue;
		changed++;
		if (targets.length <= 20) {
			console.log(status ? styleText(statusStyles[status], status.padEnd(8)) : styleText('dim', 'unmarked'), pr ? `${key} ${pr.title}` : key);
		}
	}

	console.log(styleText('dim', `${changed} mark${changed == 1 ? '' : 's'} updated in ${displayPath(cli.opts().state)}`));
}

const idsArg = new Argument('<ids...>', 'PR numbers (12345, #12345, or URLs) or API IDs, which may contain * wildcards; `-` reads IDs from stdin');

cli.command('resolve')
	.description('Mark PRs or APIs as resolved')
	.addArgument(idsArg)
	.option('-m, --message <note>', 'Attach a note to the mark')
	.action((ids, { message }) => mark('resolved', ids, message));

cli.command('ignore')
	.description('Mark PRs or APIs as not applicable to ZenFS')
	.addArgument(idsArg)
	.option('-m, --message <note>', 'Attach a note to the mark')
	.action((ids, { message }) => mark('ignored', ids, message));

cli.command('unmark')
	.description('Remove marks')
	.addArgument(idsArg)
	.action(ids => mark(undefined, ids));

cli.command('marks')
	.description('List marks')
	.action(() => {
		const { node, marks } = load();
		const entries = [...marks].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }));
		if (!entries.length) return console.log(styleText('dim', `No marks in ${displayPath(cli.opts().state)}`));
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
	});

await cli.parseAsync();
