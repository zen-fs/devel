#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { constants as c, writeFileSync } from 'node:fs';
import { resolve } from 'node:path/posix';
import { parseArgs, styleText, type InspectColor } from 'node:util';
import makeIndex from '../make_index.js';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		ignore: { short: 'i', type: 'string', multiple: true, default: [] },
		output: { short: 'o', type: 'string', default: 'index.json' },
		quiet: { short: 'q', type: 'boolean', default: false },
		xdev: { type: 'boolean', default: false },
		verbose: { type: 'boolean', default: false },
	},
	allowPositionals: true,
});

const root = positionals.at(-1) || '.';

if (options.help) {
	console.log(`make-index <path> [...options]

path: The path to create a listing for

options:
    -h, --help              Outputs this help message
    -q, --quiet             The command will not generate any output, including error messages.
        --verbose           Output verbose messages
        --xdev              Force crossing device/FS boundaries
    -o, --output <path>     Path to the output file. Defaults to listing.
    -i, --ignore <pattern>  Ignores files which match the glob <pattern>. Can be passed multiple times.
	`);
	process.exit();
}

if (options.quiet && options.verbose) {
	console.log('Can not use both --verbose and --quiet.');
	process.exit();
}

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
