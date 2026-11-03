#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { Command, InvalidArgumentError, Option } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, rmSync } from 'node:fs';
import { join, parse, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import type * as CI from '../ci.js';

function positiveInteger(value: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new InvalidArgumentError('Not a positive integer.');
	return number;
}

const cli = new Command('zenfs-test')
	.description('Runs the ZenFS test suites')
	.argument('[paths...]', 'The setup files to run tests on')

	.optionsGroup('Behavior:')
	.option('-a, --auto', 'Automatically detect setup files')
	.option('-b, --build', 'Run the npm build script prior to running tests')
	.option('-c, --common', 'Also run tests not specific to any backend')
	.option('-e, --exit-on-fail', 'If any tests suites fail, exit immediately')
	.option('-r, --runs <n>', 'Run tests n times and print average result', positiveInteger, 1)
	.option('-t, --test <glob>', 'Which FS test suite(s) to run')
	.option('-f, --force', 'Whether to use --test-force-exit')
	.option('-I, --inspect', 'Use the inspector for debugging')
	.option('-s, --skip <pattern...>', 'Skip tests with names matching the given pattern; can be passed multiple times', [])
	.option('-d, --debug', 'Output debug messages from the test runner')

	.optionsGroup('Output:')
	.option('-v, --verbose', 'Output verbose messages')
	.addOption(new Option('-q, --quiet', "Don't output normal messages").conflicts('verbose'))
	.option('-l, --log <level>', 'Change the default log level for test output; can be a number or string')
	.option('-N, --file-names', 'Use full file paths for tests from setup files instead of the base name')
	.option('-C, --ci', 'Continuous integration (CI) mode, which reports to the GitHub Checks API; requires @octokit/action')

	.optionsGroup('Coverage:')
	.option('--coverage <dir>', 'Override the default coverage data directory', 'tests/.coverage')
	.option('-p, --preserve', 'Do not delete or report coverage data')
	.option('--report', 'Report coverage along with test results')
	.option('--report-only', 'Only report coverage')
	.option('--clean', 'Only clean up the coverage directory')
	.option('--profile', 'Record performance profiles')
	.parse();

const options = cli.opts();
const [positionals] = cli.processedArgs;

function debug(...args: unknown[]): void {
	if (options.debug || process.env.DEBUG)
		console.debug(styleText('dim', '[debug]'), ...args.map(a => (typeof a === 'string' ? styleText('dim', a) : a)));
}

process.env.NODE_V8_COVERAGE = options.coverage;
process.env.ZENFS_LOG_LEVEL = options.log ?? '';
if (options.verbose) process.env.VERBOSE = '1';

if (options.clean) {
	rmSync(options.coverage, { recursive: true, force: true });
	process.exit();
}

function report(): void {
	try {
		execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('c8/bin/c8.js')), 'report', '--reporter=text'], { stdio: 'inherit' });
	} catch (e) {
		console.error('Failed to generate coverage report!');
		console.error(e);
	} finally {
		rmSync(options.coverage, { recursive: true });
	}
}

if (options.reportOnly) {
	report();
	process.exit();
}

const nRuns = options.runs;

let ci: typeof CI | undefined;
if (options.ci) {
	if (nRuns != 1) {
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
			if (options.exitOnFail) process.exit();
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

const testsGlob = join(import.meta.dirname, `../tests/fs/${options.test || '*'}.test.js`);

for (const setupFile of positionals) {
	if (!existsSync(setupFile)) {
		if (!options.quiet) console.warn('Skipping tests for non-existent setup file:', setupFile);
		continue;
	}

	process.env.SETUP = setupFile;

	const name = options.fileNames && !options.ci ? setupFile : parse(setupFile).name;

	await runTests({
		name,
		args: [`${testsGlob.replaceAll("'", "\\'")}`, process.env.CMD || ''],
		shouldSkip() {
			return basename(setupFile).startsWith('_') && !!options.auto;
		},
	});
}

if (!options.preserve && options.report) report();
