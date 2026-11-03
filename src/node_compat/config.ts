// SPDX-License-Identifier: LGPL-3.0-or-later
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { JSONFileMap } from 'utilium/fs';

export const configPath = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'zenfs', 'node-compat.json');

/**
 * Path to the saved Node.js clone, if any.
 */
export function savedRepo(): string | undefined {
	if (!existsSync(configPath)) return;
	return new JSONFileMap<string>(configPath, { overwrite_invalid: true }).get('repo');
}

export function saveRepo(path: string): void {
	mkdirSync(dirname(configPath), { recursive: true });
	new JSONFileMap<string>(configPath, { overwrite_invalid: true }).set('repo', path);
}
