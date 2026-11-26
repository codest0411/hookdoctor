# Competitor & Ecosystem Analysis

This document surveys existing tools and built-in troubleshooting commands for diagnosing whether Git hooks are installed, active, and properly configured.

## Existing Tools

| Tool | URL | What it does | What it does NOT do |
| --- | --- | --- | --- |
| **Husky** (`husky`) | <https://typicode.github.io/husky/> | Manages `.husky/` hooks via `core.hooksPath` (`.husky/_` in v9). Docs explain manual `git config core.hooksPath` checks and `HUSKY=0`. | No built-in `doctor` or `diagnose` command; does not detect conflicting managers, orphaned `.git/hooks`, missing `npm run` scripts, or broken shebangs. |
| **Lefthook** (`lefthook`) | <https://lefthook.dev/usage/commands/check-install.html> | Provides `lefthook check-install` (exit 0/1 if hooks are synced) and `lefthook validate` (validates `lefthook.yml`). | Scoped strictly to Lefthook itself; does not inspect `core.hooksPath` overrides from global/system config, other managers' hooks, shebang/PATH issues, or missing `package.json` scripts. |
| **simple-git-hooks** | <https://www.npmjs.com/package/simple-git-hooks> | Lightweight zero-dep hook writer for `.git/hooks/*` configured in `package.json`. | No diagnostic/status command; silently does nothing if `prepare` was skipped or `core.hooksPath` is overridden elsewhere. |
| **pre-commit** (Python) | <https://pre-commit.com/> | Multi-language hook runner. `pre-commit install` refuses to run if `core.hooksPath` is set ("Cowardly refusing to install hooks with core.hooksPath set"). | No general read-only diagnostic command for all Git hooks, shebangs, `.npmrc` `ignore-scripts`, or JS hook managers. |
| **git-hooks-list** | <https://www.npmjs.com/package/git-hooks-list> | Exports a static array of standard Git hook names. | Library constant only; performs no inspection or diagnostics. |
| **hookah** | <https://github.com/evilmartians/lefthook> | Historical name for Lefthook (and minor webhook utilities). | Superseded by Lefthook. |

## Differentiation

No existing tool provides a cross-manager, read-only, offline diagnostic for *why* Git hooks in a repository will or will not run. Each manager's own checks (`lefthook check-install`, `pre-commit`'s `core.hooksPath` refusal, Husky's manual troubleshooting docs) only understand that single tool and assume the developer already knows which manager is supposed to be active. **hookdoctor** inspects Git's actual hook resolution chain (`git config --show-scope --show-origin`, `git rev-parse --git-path hooks`, file permissions, shebangs, PATH resolution, `.npmrc`, environment flags, and declared managers) without executing any untrusted repository code, and explains the full decision chain for every hook.
