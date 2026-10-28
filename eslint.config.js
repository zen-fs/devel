import { defineConfig } from 'eslint/config';
import shared from './eslint.shared.js';

export default defineConfig(
	...shared,
	{
		files: ['src/**/*.ts'],
		name: 'Enable typed checking',
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		name: 'Test suite overrides',
		files: ['src/tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{ name: 'Ignores', ignores: ['tests/{coverage,tmp}'] },
);
