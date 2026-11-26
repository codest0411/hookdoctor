# Security Review & Threat Model

## Threat Model

`hookdoctor` is designed to run against **untrusted repositories** (e.g., freshly cloned third-party repos, PRs in CI). A malicious repository may contain:
- Arbitrary shell commands in `.git/hooks/*`, `.husky/*`, `lefthook.yml`, or `package.json` scripts
- Malicious Git config values (`core.fsmonitor`, `core.sshCommand`, `core.hooksPath`)
- Symlinks inside `.git/hooks/` pointing to sensitive files outside the repository (e.g., `/etc/passwd`, `~/.ssh/id_rsa`)
- Multi-megabyte hook files or deeply nested/adversarial strings designed to trigger ReDoS or OOM
- ANSI escape sequences, control characters, or GitHub Actions workflow command injections (`::error::`, `%0A`) in filenames or config values

## Security Controls Implemented

- [x] **Zero code execution:** Never executes hooks, interpreters, or `package.json` scripts. Only runs whitelisted read-only Git plumbing (`--version`, `rev-parse`, `config`) via `execFile` with argument arrays, `shell: false`, 5s timeout, 1 MB buffer limit, `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`.
- [x] **Path & symlink containment:** `safeReadFile` resolves `fs.realpathSync` and verifies the target resides inside allowed repository/hooks roots (or exact user config files `~/.npmrc`), capping reads at 32–256 KB.
- [x] **Output sanitization:** `stripControlChars` removes ANSI CSI/OSC sequences and C0/C1 control characters; `escapeGithubAnnotation` escapes `%`, `\r`, `\n`, and `::` for GitHub annotations.
- [x] **Secret hygiene:** Never prints raw environment variable values (`CI`, `HUSKY`, `npm_config_ignore_scripts`).
- [x] **Linear-time parsing:** No backtracking regexes in shebang, `.npmrc`, or script-reference parsers; verified with fuzz/adversarial tests.
- [x] **Prototype-pollution & config safety:** `loadConfig` strictly validates allowed keys and uses `Map` / `Object.create(null)`.
- [x] **Supply chain:** Zero runtime dependencies, lockfile committed, `npm audit` clean, GitHub Actions pinned to commit SHAs with minimal `permissions:`, CodeQL, Dependabot, and npm `--provenance`.
