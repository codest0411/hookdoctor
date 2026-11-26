# Known Limitations & Future Work

## Current Limitations

1. **Line-based parsing of manager configs:** `lefthook.yml` and `.pre-commit-config.yaml` are parsed with a lightweight line-based scanner rather than a full YAML parser (to preserve zero runtime dependencies). Complex YAML anchors, multi-line strings, or `extends` / `remotes` includes in `lefthook.yml` are not expanded.
2. **Recognized managers only:** `hookdoctor` knows the layouts of `husky`, `lefthook`, `simple-git-hooks`, and `pre-commit`. Hooks installed by custom scripts or other tools are still checked for directory existence, executable bit, shebang, and `package.json` script references, but cannot be matched to an unconfigured manager.
3. **Static, offline diagnosis only:** `hookdoctor` never executes hooks, interpreters, or npm scripts. It can prove a hook *will not* run or *will* fail to launch, but it cannot prove that a hook's linter or test suite will pass when executed.
4. **Windows POSIX shebangs:** On Windows, Git for Windows executes POSIX shebangs (`/bin/sh`, `/bin/bash`, `/usr/bin/env`) via Git Bash. `hookdoctor` treats standard Git Bash virtual paths as valid on `win32`.

## Future Work: `--fix` (Out of Scope for MVP)

Automatic remediation (`--fix`) is intentionally excluded from the MVP. Modifying `.git/config`, running `npm` / manager install commands, or changing file permissions on an untrusted or shared repository carries safety risks (e.g., executing `prepare` scripts or overwriting a developer's intentional global `core.hooksPath`). Any future `--fix` mode would require explicit interactive confirmation and dry-run previews.
