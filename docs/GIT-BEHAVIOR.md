# Verified Git Hook Behavior

This document records verified facts from official Git documentation used by `hookdoctor`.

## Hook Directory Resolution & `core.hooksPath`

- **Default hooks directory:** By default, hooks are stored in `$GIT_DIR/hooks` (typically `.git/hooks` in a standard repository, or `$GIT_COMMON_DIR/hooks` in linked worktrees).
  - Source: <https://git-scm.com/docs/githooks>
- **`core.hooksPath` override:** Setting `core.hooksPath` tells Git to look in the specified directory instead of the default hooks directory.
  - Source: <https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath>
- **Relative paths & worktrees:** When `core.hooksPath` is a relative path, Git resolves it relative to the root of the working tree (`git rev-parse --show-toplevel`) for non-bare repositories, or relative to `$GIT_DIR` for bare repositories. In linked worktrees, `git rev-parse --git-path hooks` returns the effective hooks path resolved by Git itself (honoring `core.hooksPath` and worktree/common-dir rules).
  - Source: <https://git-scm.com/docs/git-rev-parse>
- **Missing `core.hooksPath` directory:** If `core.hooksPath` points to a directory that does not exist, Git runs no hooks and emits no error.

## Executable Bit & `advice.ignoredHook`

- **Executable requirement (POSIX):** On Unix-like systems, Git ignores any hook file that does not have the executable bit set.
  - Source: <https://git-scm.com/docs/githooks>
- **`advice.ignoredHook`:** By default (`true`), Git prints a hint (`The '<path>' hook was ignored because it's not set as executable.`) when a hook lacks execute permissions. Setting `advice.ignoredHook` to `false` suppresses the hint, making the failure completely silent.
  - Source: <https://git-scm.com/docs/git-config#Documentation/git-config.txt-adviceignoredHook>
- **Sample files:** Git initializes `.git/hooks/` with `*.sample` files; Git ignores `*.sample` files.

## Configuration Precedence, Scopes, and `includeIf`

- **Precedence:** Git configuration values are evaluated in order from lowest to highest precedence: `system` -> `global` -> `local` -> `worktree` -> `command` (CLI `-c` / env). Conditional includes (`includeIf`) are evaluated within the file where they appear.
  - Source: <https://git-scm.com/docs/git-config>
- **`--show-origin` and `--show-scope`:**
  - `--show-origin` was introduced in **Git 2.8.0**.
  - `--show-scope` was introduced in **Git 2.26.0** (reports `system`, `global`, `local`, `worktree`, `command`).
  - Source: <https://git-scm.com/docs/git-config#Documentation/git-config.txt---show-scope>
- **Minimum Git version:** `hookdoctor` requires Git >= 2.26.0 for full `--show-scope` support and degrades gracefully on Git >= 2.8.0 (using `--show-origin` without `--show-scope`, marking scope as `unknown`). Versions older than 2.8.0 exit with code 2 and a clear upgrade message.

## Safe Directory (`safe.directory`)

- Since Git 2.35.2, Git refuses to operate in repositories owned by a different user with `fatal: detected dubious ownership in repository at ...`. `hookdoctor` surfaces this error clearly (exit code 2) and never modifies `safe.directory`.
  - Source: <https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory>
