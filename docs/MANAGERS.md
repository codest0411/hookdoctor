# Hook Manager Layouts (Verified)

This document records the real on-disk layouts and installation mechanisms observed for the four supported hook managers.

## 1. Husky (v9+)

- **Docs:** <https://typicode.github.io/husky/>
- **Detection signals:**
  - `husky` in `package.json` `dependencies` or `devDependencies`
  - `.husky/` directory present
- **Install mechanism:**
  - `"prepare": "husky"` in `package.json` `scripts` (runs on `npm install` unless `--ignore-scripts`, `ignore-scripts=true` in `.npmrc`, `HUSKY=0`, or `CI` skips it).
- **On-disk layout (verified with `husky` v9 via `npx husky init`):**
  - Sets local Git config: `core.hooksPath = .husky/_`
  - Creates `.husky/_/` containing:
    - `.gitignore` (`*`)
    - `h` (shell dispatcher)
    - `husky.sh` (deprecated shim)
    - Standard hook stubs (`pre-commit`, `commit-msg`, `pre-push`, etc., ~39 bytes each) that invoke `h`
  - User hook scripts live at `.husky/<hook-name>` (e.g. `.husky/pre-commit`).
- **Executable bit requirement:**
  - The stub files inside `.husky/_/` are executed by Git and **must** be executable on POSIX.
  - The user script `.husky/<hook-name>` is **sourced** (`. "$0"`) by `.husky/_/h`, so `.husky/<hook-name>` does **not** require a shebang or the executable bit. `hookdoctor` must NOT flag `.husky/<hook-name>` for missing `+x` or missing shebang.

## 2. Lefthook

- **Docs:** <https://lefthook.dev/configuration/>
- **Detection signals:**
  - `lefthook`, `@evilmartians/lefthook`, or `lefthook-plugin` in `package.json`
  - Config file: `lefthook.yml`, `lefthook.yaml`, `.lefthook.yml`, `.lefthook.yaml`, `lefthook.json`, or `lefthook-local.yml`
- **Install mechanism:**
  - `lefthook install` (often via `"prepare": "lefthook install"` or postinstall).
- **On-disk layout:**
  - Does **not** overwrite `core.hooksPath` by default; writes hook runner scripts into the effective hooks directory (typically `.git/hooks/<hook-name>`).
  - Generated hook scripts have `#!/bin/sh` and invoke `lefthook run <hook-name> "$@"`.
- **Executable bit requirement:**
  - Generated `.git/hooks/<hook-name>` files are executed directly by Git and **must** be executable on POSIX.

## 3. simple-git-hooks

- **Docs:** <https://www.npmjs.com/package/simple-git-hooks>
- **Detection signals:**
  - `simple-git-hooks` in `package.json` `dependencies` or `devDependencies`, or `"simple-git-hooks"` key in `package.json`
  - Standalone config files: `.simple-git-hooks.json`, `simple-git-hooks.json`, `.simple-git-hooks.cjs`, `.simple-git-hooks.js`
- **Install mechanism:**
  - `npx simple-git-hooks` (typically via `"prepare": "simple-git-hooks"` or postinstall).
- **On-disk layout (verified with `simple-git-hooks`):**
  - Leaves `core.hooksPath` unset; writes directly to `.git/hooks/<hook-name>`.
  - Generated hook starts with `#!/bin/sh`, checks `SKIP_SIMPLE_GIT_HOOKS=1` and `SIMPLE_GIT_HOOKS_RC`, then runs the configured command (e.g. `npm test`).
- **Executable bit requirement:**
  - Generated `.git/hooks/<hook-name>` files are executed directly by Git and **must** be executable on POSIX.

## 4. pre-commit (Python framework)

- **Docs:** <https://pre-commit.com/>
- **Detection signals:**
  - `.pre-commit-config.yaml` (or `.pre-commit-config.yml`) at repository root
- **Install mechanism:**
  - `pre-commit install` (writes wrapper script to `.git/hooks/pre-commit`, or other hook types with `-t`).
  - Refuses to install if `core.hooksPath` is set.
- **On-disk layout:**
  - Writes `.git/hooks/<hook-name>` with a Python/sh shebang (`#!/usr/bin/env python3` or `#!/usr/bin/env bash`) invoking `pre-commit hook-impl`.
- **Executable bit requirement:**
  - Generated `.git/hooks/<hook-name>` files are executed directly by Git and **must** be executable on POSIX.
