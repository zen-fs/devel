// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * @param version A full or partial version, optionally prefixed with `v`
 */
export function parseVersion(version: string): [major: number, minor: number, patch: number] {
	const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, '').split('.').map(Number);
	return [major, minor, patch];
}

/**
 * Whether `version` is a full version, optionally prefixed with `v`, rather than a placeholder like `REPLACEME`
 */
export function isVersion(version: string): boolean {
	return /^v?\d+\.\d+\.\d+$/.test(version);
}

export function compareVersions(left: string, right: string): number {
	const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
	const [rightMajor, rightMinor, rightPatch] = parseVersion(right);
	return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}
