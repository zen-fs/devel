#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import * as ci from '../ci.js';

const zci = new Command('zci').description('Manages GitHub check runs for CI').enablePositionalOptions();

zci.command('init')
	.description('Create checks in a queued state')
	.action(async () => {
		for (const [id, name] of Object.entries(ci.checkNames)) {
			await ci.createCheck(id, name);
		}
	});

zci.command('list')
	.description('List checks')
	.action(() => {
		const max = Math.max(...Object.keys(ci.checkNames).map(id => id.length)) + 1;
		for (const [id, name] of Object.entries(ci.checkNames)) {
			console.log(id.padEnd(max), name);
		}
	});

zci.command('run')
	.description('Run a command and use its exit code as the completion status')
	.argument('<name>', 'Check to report to')
	.argument('<command...>', 'Command to run')
	.passThroughOptions()
	.action(async (name, command) => {
		await ci.startCheck(name);

		const { status } = spawnSync(command.join(' '), { shell: true, stdio: 'inherit' });

		await ci.completeCheck(name, status ? 'failure' : 'success');

		process.exit(status);
	});

zci.command('cleanup')
	.description('Mark all remaining checks as completed with a neutral status')
	.action(async () => {
		for (const id of Object.keys(ci.checkNames)) {
			await ci.completeCheck(id, 'neutral');
		}
	});

await zci.parseAsync();
