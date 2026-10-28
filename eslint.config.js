import { defineConfig } from 'eslint/config';
import shared from './eslint.shared.js';

export default defineConfig(
	...shared,
	{
		files: ['tests/**/*.ts'],
		name: 'Enable typed checking',
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{ name: 'Ignores', ignores: ['tests/{coverage,tmp}'] },
);
