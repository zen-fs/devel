# ZenFS Development

Tooling for developing [ZenFS](https://github.com/zen-fs/core) packages, such as third-party backends.
This is only needed when _authoring_ for ZenFS.

```sh
npm install --save-dev @zenfs/devel
```

## Tests

`@zenfs/devel` includes the `fs` conformance suite that every `@zenfs` package is tested with, along with the `zenfs-test` runner.

```sh
npx zenfs-test tests/setup-idb.ts   # one specific setup file
npx zenfs-test -ac                  # every setup file it can find, plus your package's other tests
```

A setup file configures ZenFS with the backend under test and populates it, for example with the bundled test data:

```ts
import { configureSingle } from '@zenfs/core';
import { copyAsync, data } from '@zenfs/devel/tests/setup';
import { MyBackend } from '../src/index.js';

await configureSingle({ backend: MyBackend });
await copyAsync(data);
```

Run `npx zenfs-test --help` for all options.

## ESLint

The shared ESLint configuration used by `@zenfs` packages:

```js
import { defineConfig } from 'eslint/config';
import shared from '@zenfs/devel/eslint';

export default defineConfig(...shared);
```

## Scripts

- `zenfs-test`: Runs tests and collects coverage
- `make-index`: Creates an index of a directory, for use with backends like `Fetch`
- `zci`: Shortcut for reporting CI steps as GitHub check runs. Used in the `@zenfs` packages' workflows.
