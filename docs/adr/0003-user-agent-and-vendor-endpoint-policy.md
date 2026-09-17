# ADR-0003: User-Agent and vendor endpoint policy

Status: Proposed (2026-09), pending decision on the embedded login fallback

## Context

None of the endpoints this app reads are public APIs. Each is what the
vendor's own client uses: the claude.ai web app, the Claude Code CLI, the
Codex CLI, the Copilot editor plugins, the Cursor app, the Gemini CLI. Some
of them check request headers. Version 1.0 spoofs a desktop Chrome
User-Agent in the login window so that Google's sign-in page accepts an
embedded browser; Google's OAuth policy blocks embedded user agents on
purpose, so that spoof is an evasion, not a compatibility fix.

## Decision

1. Where a vendor's own tooling has already written a credential to disk,
   that credential is the default path. No browser login is shown.
2. Requests to a vendor endpoint carry exactly the headers that vendor's
   own client sends, no more and no less, and those headers are written
   down per provider (in the provider folder and in `SECURITY.md`). The
   app does not invent identities and does not pretend to be a browser
   for an endpoint that its own client calls with a CLI identity.
3. A browser login window, where kept at all, is a labelled fallback. It
   uses its own partition, no preload, a deny-all permission handler, and
   an allowlist of navigable origins. It never carries a spoofed
   User-Agent for Google's pages. If Google's flow does not work inside
   an embedded window, the fallback opens the system browser instead.
4. Every endpoint is validated with a schema on read; a shape change marks
   the card stale, it never crashes the app.
5. Vendor terms of service are reviewed by a person before a provider
   ships, and the outcome is recorded in the provider's README.

## Consequences

- Some accounts (claude.ai accounts that have never used Claude Code) get
  a less convenient path until decision 3 is settled.
- Provider code becomes auditable: the headers it sends are a fixed list
  in one file.
- The Chrome User-Agent constant is removed once the fallback is
  reworked; until then `SECURITY.md` names it as a known limitation.
