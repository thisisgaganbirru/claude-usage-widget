# ADR-0001: Electron over Tauri for v2.0

Status: Accepted (2026-09)

## Context

The app is a tray widget that polls a few HTTPS endpoints and shows numbers.
A Tauri build would be roughly a tenth of the download and use far less
memory, and people ask about it in every Electron project of this size.
Against that: the codebase, the build pipeline (Forge with the webpack
plugin and fuses), the embedded login window, and the maintainer's working
knowledge are all Electron. The multi-vendor rewrite is already a large
change on its own.

## Decision

Ship v2.0 on Electron, on a supported major (44 at the time of writing),
and keep the runtime current through Dependabot for minors and deliberate
bumps for majors. Revisit Tauri after v2.0 with the provider layer already
separated, so the port would be a shell swap rather than a rewrite.

## Consequences

- Install size and memory stay Electron-sized. The README says so instead
  of pretending otherwise.
- Everything that touches the vendors lives in plain TypeScript modules
  with no Electron import, so a later port carries them unchanged.
- The Electron security checklist is followed in full (sandbox, CSP,
  permission handlers, typed IPC) because the runtime's attack surface
  is the price of this choice.
