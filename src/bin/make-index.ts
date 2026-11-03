#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { Command, Option } from 'commander';
import { constants as c, writeFileSync } from 'node:fs';
import { resolve } from 'node:path/posix';
import { styleText, type InspectColor } from 'node:util';
import makeIndex from '../make_index.js';

const cli = new Command('make-index')
	.description('Creates an index of a directory, for use with backends like Fetch')
	.argument('[path]', 'The path to create a listing for', '.')
	.option('-o, --output <path>', 'Path to the output file', 'index.json')
	.option('-i, --ignore <pattern...>', 'Ignore files which match the glob pattern; can be passed multiple times', [])
	.option('--xdev', 'Force crossing device/FS boundaries')
	.addOption(new Option('-q, --quiet', "Don't output anything, including errors").conflicts('verbose'))
	.option('--verbose', 'Output verbose messages')
	.parse();

const options = cli.opts();
const [root] = cli.processedArgs;

function fixSlash(path: string): string {
	return path.replaceAll('\\', '/');
}

const typeMap: Record<string, InspectColor> = {
	file: 'green',
	' dir': 'blue',
	' sym': 'cyan',
	' dev': 'yellow',
	sock: 'magenta',
	fifo: 'blue',
};

function getTypeText(stats: { mode: number }): string {
	switch (stats.mode & c.S_IFMT) {
		case c.S_IFBLK:
		case c.S_IFCHR:
			return ' dev';
		case c.S_IFIFO:
			return 'fifo';
		case c.S_IFSOCK:
			return 'sock';
		case c.S_IFREG:
			return 'file';
		case c.S_IFDIR:
			return ' dir';
		case c.S_IFLNK:
			return ' sym';
		default:
			throw new Error(`Unknown file type: 0o${(stats.mode & c.S_IFMT).toString(8)}`);
	}
}

const index = makeIndex(root, {
	ignore: options.ignore,
	xdev: options.xdev,
	onWarning(message) {
		console.warn(styleText('yellowBright', message));
	},
	onError(path, error) {
		if (!options.quiet) console.log(`${styleText('red', 'fail')} ${path}: ${error.message}`);
	},
	onEntry(path, stats) {
		if (!options.verbose) return;
		const type = getTypeText(stats);
		console.log(`${styleText(typeMap[type] || 'white', type)} ${path}`);
	},
	onIgnore(path) {
		if (!options.quiet) console.log(`${styleText('yellow', 'skip')} ${path}`);
	},
});

if (!options.quiet) {
	console.log('Generated listing for ' + fixSlash(resolve(root)));
}

writeFileSync(options.output, JSON.stringify(index));
