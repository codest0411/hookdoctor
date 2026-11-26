# Contributing to hookdoctor

Thank you for your interest in contributing!

## Development Setup

```bash
git clone <repo-url>
cd hookdoctor
npm install
```

## Checks

Run these locally before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run build:types
npm run test:coverage
npm run dogfood
```

## Design Principles

- **Zero runtime dependencies:** Node.js built-ins only (`node:*`).
- **Read-only & offline:** Never execute repository hooks, interpreters, or npm scripts; never make network requests.
- **Manager knowledge:** Keep manager-specific detection in `src/managers/*.js` backed by documented links in `docs/MANAGERS.md`.
