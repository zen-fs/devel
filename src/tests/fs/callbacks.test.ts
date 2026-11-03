// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

/**
 * Runs `run` with the process' error listeners replaced, collecting errors that escape callbacks.
 */
async function collectEscaped(run: () => void): Promise<unknown[]> {
	const events = ['uncaughtException', 'unhandledRejection'] as const;
	const saved = events.map(event => [event, process.rawListeners(event)] as const);
	const escaped: unknown[] = [];
	const collect = (error: unknown) => escaped.push(error);

	for (const event of events) {
		process.removeAllListeners(event);
		process.on(event, collect);
	}

	try {
		run();
		await new Promise(resolve => setTimeout(resolve, 50));
	} finally {
		for (const [event, listeners] of saved) {
			process.removeAllListeners(event);
			for (const listener of listeners) process.on(event, listener as (...args: unknown[]) => void);
		}
	}

	return escaped;
}

suite('Callbacks', config('async'), () => {
	test('a callback that throws is only called once', async () => {
		let calls = 0;
		const thrown = new Error('thrown by callback');

		const escaped = await collectEscaped(() =>
			fs.stat('/', () => {
				calls++;
				throw thrown;
			}),
		);

		assert.equal(calls, 1);
		assert.deepEqual(escaped, [thrown]);
	});
});
