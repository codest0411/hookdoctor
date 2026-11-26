# Diagnostic Rules Reference

Every finding emitted by `hookdoctor` includes an ID, severity, evidence, a "why it matters" explanation, and a suggested next step labelled **"Verify before running"**.

## HD001 — Hook manager declared but not installed (`error`)

Triggered when a supported hook manager (`husky`, `lefthook`, `simple-git-hooks`, `pre-commit`) is declared in `package.json`, manager config files, or `.hookdoctorrc.json` `expectedManagers`, but its hooks are not installed in Git's effective hooks directory.

- **Example:** `husky` is in `devDependencies` and `.husky/pre-commit` exists, but `core.hooksPath` is not set to `.husky/_`.
- **Verify before running:** Inspect `package.json` and run the manager's install step (e.g., `npm install` or `npx husky`).

## HD002 — `core.hooksPath` points to a missing or non-directory path (`error`)

Triggered when `core.hooksPath` is configured, but the resolved directory does not exist or is not a directory. Git silently skips all hooks without error.

- **Example:** `git config core.hooksPath .githooks` where `.githooks/` does not exist.
- **Verify before running:** Create/install the target directory or unset `core.hooksPath` if obsolete.

## HD003 — Global/system `core.hooksPath` override or orphaned `.git/hooks` (`warn`)

Triggered when:
1. A `global` or `system` `core.hooksPath` overrides the repository's hooks, or
2. Non-sample hook files exist in `.git/hooks` while `core.hooksPath` points to a different directory.

- **Verify before running:** Inspect `git config --list --show-scope --show-origin` and consolidate hooks into the active directory.

## HD004 — Hook file is not executable (`error`, POSIX only)

Triggered on Unix-like systems when a hook file executed directly by Git lacks the executable bit (`+x`). Skipped with an explicit explanation on Windows or when `core.fileMode=false`. Does **not** flag sourced user scripts like `.husky/pre-commit` when `core.hooksPath` is `.husky/_`.

- **Verify before running:** Inspect the hook file and run `chmod +x <file>`.

## HD005 — Shebang or interpreter problem (`error` / `warn`)

Triggered when a direct hook file has:
- `crlf-shebang` (`error`): first line ends with `\r\n`
- `interpreter-not-found` / `env-interpreter-not-found` (`error`): interpreter path or `env` target not found on `PATH`
- `missing-shebang` / `invalid-shebang` / `empty-file` (`warn`)

- **Verify before running:** Ensure line 1 uses LF endings and a valid shebang (e.g., `#!/bin/sh`).

## HD006 — Manager install step would be skipped (`warn`, or `info` with `--ci`)

Triggered when an npm-based hook manager is declared and:
- `package.json` has no `prepare` or `postinstall` script invoking it, or
- `ignore-scripts=true` is set in project `.npmrc` or user `~/.npmrc`, or
- `npm_config_ignore_scripts` or `HUSKY=0` is set, or
- `CI` environment variable is set (downgraded to `info` when `--ci` is passed).

## HD007 — Multiple hook managers or conflicting `core.hooksPath` (`warn`)

Triggered when more than one hook manager is declared (e.g., both `husky` and `lefthook`), or when multiple `core.hooksPath` entries exist across Git config scopes.

## HD008 — Missing `package.json` script referenced by hook (`warn`)

Triggered when a hook file or manager config invokes `npm run <name>`, `npm test`, `pnpm <name>`, or `yarn <name>`, and `<name>` is not defined in `package.json` `scripts`. Heuristic `pnpm <name>` / `yarn <name>` matches without `run` are labelled `(low confidence)`.

## HD009 — Hook inventory summary (`info`)

Lists every standard Git hook discovered in the effective hooks directory, `.git/hooks`, or manager configs, along with its state (`active`, `inactive`, `ignored`), source file, and owning manager.
