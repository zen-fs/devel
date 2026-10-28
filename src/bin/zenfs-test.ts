#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, rmSync } from 'node:fs';
import { join, parse, basename } from 'node:path';
import { parseArgs, styleText } from 'node:util';
import type * as CI from '../ci.js';

const { values: options, positionals } = parseArgs({
	options: {
		// Output
		help: { short: 'h', type: 'boolean', default: false },
		verbose: { short: 'v', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		log: { short: 'l', type: 'string', default: '' },
		'file-names': { short: 'N', type: 'boolean', default: false },
		ci: { short: 'C', type: 'boolean', default: false },
		debug: { short: 'd', type: 'boolean', default: false },

		// Test behavior
		test: { short: 't', type: 'string' },
		force: { short: 'f', type: 'boolean', default: false },
		auto: { short: 'a', type: 'boolean', default: false },
		build: { short: 'b', type: 'boolean', default: false },
		common: { short: 'c', type: 'boolean', default: false },
		inspect: { short: 'I', type: 'boolean', default: false },
		skip: { short: 's', type: 'string', multiple: true, default: [] },
		'exit-on-fail': { short: 'e', type: 'boolean' },
		runs: { short: 'r', type: 'string', default: '1' },

		// Coverage and performance
		coverage: { type: 'string', default: 'tests/.coverage' },
		preserve: { short: 'p', type: 'boolean' },
		report: { type: 'boolean', default: false },
		'report-only': { type: 'boolean', default: false },
		clean: { type: 'boolean', default: false },
		profile: { type: 'boolean', default: false },
	},
	strict: true,
	allowPositionals: true,
});

function debug(...args: unknown[]): void {
	if (options.debug || process.env.DEBUG)
		console.debug(styleText('dim', '[debug]'), ...args.map(a => (typeof a === 'string' ? styleText('dim', a) : a)));
}

if (options.help) {
	console.log(`zenfs-test [...options] <...paths> 

Paths: The setup files to run tests on

Behavior:
    -a, --auto            Automatically detect setup files
    -b, --build           Run the npm build script prior to running tests
    -c, --common          Also run tests not specific to any backend
    -e, --exit-on-fail    If any tests suites fail, exit immediately
    -r, --runs <n>        Run tests n times and print average result
    -t, --test <glob>     Which FS test suite(s) to run
    -f, --force           Whether to use --test-force-exit
    -I, --inspect         Use the inspector for debugging
    -s, --skip <pattern>  Skip tests with names matching the given pattern. Can be specified multiple times.
    -d, --debug           Output debug messages from the test runner

Output:
    -h, --help            Outputs this help message
    -v, --verbose         Output verbose messages
    -q, --quiet           Don't output normal messages
    -l, --logs <level>    Change the default log level for test output. Level can be a number or string
    -N, --file-names      Use full file paths for tests from setup files instead of the base name
    -C, --ci              Continuous integration (CI) mode. This interacts with the Github
                          Checks API for better test status. Requires @octokit/action

Coverage:
    --coverage <dir>      Override the default coverage data directory
    -p, --preserve        Do not delete or report coverage data
    --report              Report coverage along with test results
    --report-only         ONLY report coverage
    --clean               ONLY clean up coverage directory
    --profile             Record performance profiles`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.error('ERROR: Can not specify --verbose and --quiet');
	process.exit(1);
}

process.env.NODE_V8_COVERAGE = options.coverage;
process.env.ZENFS_LOG_LEVEL = options.log;
if (options.verbose) process.env.VERBOSE = '1';

if (options.clean) {
	rmSync(options.coverage, { recursive: true, force: true });
	process.exit();
}

function report(): void {
	try {
		execFileSync('npx', ['--silent', 'c8', 'report', '--reporter=text'], { stdio: 'inherit' });
	} catch (e) {
		console.error('Failed to generate coverage report!');
		console.error(e);
	} finally {
		rmSync(options.coverage, { recursive: true });
	}
}

if (options['report-only']) {
	report();
	process.exit();
}

const nRuns = Number.isSafeInteger(parseInt(options.runs)) ? parseInt(options.runs) : 1;

let ci: typeof CI | undefined;
if (options.ci) {
	if (options.runs && nRuns !== 1) {
		console.error('Cannot use --ci with --runs');
		process.exit(1);
	}
	ci = await import('../ci.js');
}

if (options.verbose && options.force) console.debug('Forcing tests to exit (--test-force-exit)');

if (options.build) {
	if (!options.quiet) process.stdout.write('Building... ');
	try {
		execFileSync('npm', ['run', 'build', '--silent'], { stdio: 'inherit' });
		console.log('done.');
	} catch {
		console.warn('failed, continuing without it.');
	}
}

if (options.auto) {
	let sum = 0;

	for (const pattern of ['**/tests/setup/*.ts', '**/tests/setup-*.ts']) {
		const files = globSync(pattern).filter(f => !f.includes('node_modules'));
		sum += files.length;
		positionals.push(...files);
	}

	if (!options.quiet) console.log(`Auto-detected ${sum} test setup files`);
}

if (!options.preserve) rmSync(options.coverage, { force: true, recursive: true });
mkdirSync(options.coverage, { recursive: true });

/**
 * Generate the command used to run the tests
 */
function makeCommand(profileName: string, ...rest: string[]): string[] {
	const command = [
		'--trace-deprecation',
		options.inspect && '--inspect',
		'--test',
		'--experimental-test-coverage',
		options.force && '--test-force-exit',
		options.skip.length && `--test-skip-pattern=${options.skip.join('|')}`,
		...(!options.profile
			? []
			: ['--cpu-prof', '--cpu-prof-dir=.profiles', `--cpu-prof-name=${profileName}.cpuprofile`, '--cpu-prof-interval=500']),
		...rest,
	].filter((value): value is string => typeof value == 'string' && !!value);
	if (!options.quiet) debug('command: ' + process.execPath, command.join(' '));

	return command;
}

/**
 * @param ms milliseconds
 */
function duration(ms: number): string {
	ms = Math.round(ms);
	let unit = 'ms';

	if (ms > 5000) {
		ms /= 1000;
		unit = 's';
	}

	return ms + ' ' + unit;
}

interface RunTestOptions {
	name: string;
	args: string[];
	statusName?: string;
	shouldSkip?(): boolean;
}

async function runTests(config: RunTestOptions): Promise<void> {
	const statusName = config.statusName || config.name;

	const command = makeCommand(config.name, ...config.args);

	let totalTime = 0;
	for (let i = 0; i < nRuns; i++) {
		const start = performance.now();

		await ci?.startCheck(statusName);

		const time = () => styleText('dim', `(${duration(Math.round(performance.now() - start))})`);

		let identText = options.verbose ? `: ${statusName}` : '';

		if (nRuns != 1) identText += ` [${i + 1}/${nRuns}]`;

		if (!options.quiet) {
			if (options.verbose) console.log('Running tests:', config.name);
			else process.stdout.write(`Running tests: ${config.name}... `);
		}

		if (config.shouldSkip?.()) {
			if (!options.quiet) console.log(`${styleText('yellow', 'skipped')}${identText} ${time()}`);
			await ci?.completeCheck(statusName, 'skipped');
			return;
		}

		try {
			execFileSync(process.execPath, command, {
				stdio: ['ignore', options.verbose ? 'inherit' : 'ignore', 'inherit'],
			});
			if (!options.quiet) console.log(`${styleText('green', 'passed')}${identText} ${time()}`);
			await ci?.completeCheck(statusName, 'success');
			totalTime += performance.now() - start;
		} catch {
			console.error(`${styleText(['red', 'bold'], 'failed')}${identText} ${time()}`);
			await ci?.completeCheck(statusName, 'failure');
			process.exitCode = 1;
			if (options['exit-on-fail']) process.exit();
			return;
		}
	}
	if (nRuns != 1) {
		console.log('Average', config.name, 'time:', styleText('blueBright', duration(totalTime / nRuns)));
	}
}

if (options.common) {
	await runTests({
		name: 'common',
		args: ['tests/*.test.ts', `tests/**/!(fs)/*.test.ts`],
		statusName: 'Common tests',
	});
}

const testsGlob = join(import.meta.dirname, `../../tests/fs/${options.test || '*'}.test.ts`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		if (!options.quiet) console.warn('Skipping tests for non-existent setup file:', setupFile);
		continue;
	}

	process.env.SETUP = setupFile;

	const name = options['file-names'] && !options.ci ? setupFile : parse(setupFile).name;

	await runTests({
		name,
		args: [`${testsGlob.replaceAll("'", "\\'")}`, process.env.CMD || ''],
		shouldSkip() {
			return basename(setupFile).startsWith('_') && options.auto;
		},
	});
}

if (!options.preserve && options.report) report();
