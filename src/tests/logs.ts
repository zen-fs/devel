// SPDX-License-Identifier: LGPL-3.0-or-later
import { log } from 'kerium';

export function setupLogs(prefix?: string): void {
	const { ZENFS_LOG_LEVEL } = process.env;

	let level: log.Level | (typeof log.levels)[number] = log.Level.ERR;

	if (ZENFS_LOG_LEVEL) {
		const tmp = parseInt(ZENFS_LOG_LEVEL);
		if (Number.isSafeInteger(tmp)) level = tmp;
		else level = ZENFS_LOG_LEVEL as (typeof log.levels)[number];
	}

	log.configure({
		enabled: true,
		format: log.fancy({ style: 'ansi', colorize: 'message' }),
		dumpBacklog: true,
		level,
		stack: true,
		output: (...msg) => (prefix ? console.error(prefix, ...msg) : console.error(...msg)),
	});
}
