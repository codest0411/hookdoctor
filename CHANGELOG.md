# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-11-26

### Added
- Initial release of `hookdoctor` CLI (`hookdoctor [path]` and `hookdoctor why <hook-name>`) and programmatic ESM API (`diagnose`, `why`).
- Diagnostic rules `HD001`–`HD009` covering missing manager installs, broken/overridden `core.hooksPath`, orphaned `.git/hooks`, missing executable bits (POSIX), shebang/CRLF/PATH issues, skipped install scripts (`.npmrc`, `HUSKY=0`, `CI`), conflicting managers, missing `package.json` scripts, and hook inventory.
- Support for Husky v9+, Lefthook, simple-git-hooks, and pre-commit.
- Output formats: `human`, `json`, `github`, `sarif`.
- Strict `.hookdoctorrc.json` configuration support.
