# Contributing

Thanks for looking. This file is the short version of how work gets in.

## Setup

- Node 22 (the version in `.nvmrc`). `engine-strict` is on, so an older
  Node fails `npm ci` on purpose.
- `npm ci`, then `npm start` for the dev build with hot reload.
- `npm run check` runs everything CI runs on a pull request: type-check,
  ESLint, the custom lint guards in `scripts/lint-guards.mjs`, Prettier,
  and the Vitest suite. Run it before you push.
- `npm run package` builds the unsigned app into `out/` if you want to
  test the packaged behaviour (tray, single instance, asar).

## Branches

Work flows `feature/<topic>` into `dev`, and `dev` into `main` when a
release is cut. Open pull requests against `dev`. `main` only receives
merges from `dev`.

## Commits and pull request titles

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
and CI checks both the commit messages and the PR title (the title becomes
the squash commit). Allowed types: `feat`, `fix`, `perf`, `refactor`,
`docs`, `test`, `build`, `ci`, `chore`, `revert`, `release`. The subject
starts with a lowercase letter and has no trailing period. Examples:

```
feat(codex): read rate limits from the app-server snapshot
fix(tray): reload the icon when the theme changes
```

Release notes and version bumps are generated from these messages by
release-please, so a `feat` is a minor bump and a `fix` a patch. Put
`BREAKING CHANGE:` in the footer for a major.

## Rules that CI enforces

- Named exports only.
- IPC channel names come from `src/shared/ipc-channels.ts`; string
  literals are rejected by the lint guard.
- Tailwind classes, no inline styles.
- No new dependencies without discussing them in the PR first. Runtime
  dependencies ship inside the app and are held to a higher bar than dev
  tooling; say what the package does, who maintains it, and why the
  standard library or Electron cannot do the job.
- No secrets, tokens, or `.env` files in the tree. No credential, cookie,
  or full URL in a log line.

## Adding a vendor

The provider interface and its fixtures are being introduced in the next
release cycle; until it lands, open a "New provider" issue with what you
know about the vendor's credential location and quota endpoint so the
research is not duplicated.

## Reporting bugs

Use the issue templates. For "a provider stopped working", attach the
diagnostics export once it exists, or the relevant lines of `main.log`
with anything sensitive removed. For security problems, see
[SECURITY.md](SECURITY.md) and do not open a public issue.

## Records of decisions

Larger choices are written down in `docs/adr/`. If your change reverses or
extends one, add a new ADR rather than editing the old one.
