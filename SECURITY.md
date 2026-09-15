# Security policy

This app holds a credential for an AI vendor account on the user's machine.
That makes it a target, so this document says what it touches, what it does
not do, and how to report a problem.

## Supported versions

Only the latest release on the [Releases page](https://github.com/thisisgaganbirru/claude-usage-widget/releases)
receives fixes. Older builds are not patched; update instead.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

1. Preferred: use GitHub's private vulnerability reporting on this repository
   ("Security" tab, then "Report a vulnerability").
2. Otherwise email gagansai9090@gmail.com with "claude-usage-widget security"
   in the subject.

Include the version, the OS, steps to reproduce, and what an attacker gains.
You will get an acknowledgement within 72 hours. Confirmed issues that expose
a credential or allow code execution are fixed in a release within 14 days
where possible, with credit in the release notes if you want it. Anything
else is triaged into the normal release cycle.

Testing against your own installation is welcome. Do not test against other
people's accounts or against the vendors' services beyond what the app
itself does.

## What the app touches

Network. The app talks only to the vendors it shows quotas for. Today that
is claude.ai:

| Endpoint                                       | Purpose                              |
| ---------------------------------------------- | ------------------------------------ |
| `https://claude.ai/login` (embedded window)    | Sign in; the app never sees the form |
| `https://claude.ai/api/organizations`          | Find the account's organisation      |
| `https://claude.ai/api/organizations/{id}/usage` | Read the usage windows             |

There is no telemetry, no crash reporting, no analytics, and no server of
ours. Each vendor added later is listed here with its endpoints before it
ships.

Disk. Under the Electron `userData` folder the app writes settings, a
random install id, and the claude.ai session cookie. Logs go to
`main.log` in the same folder and are rotated at 2 MB. Log lines never
include the cookie, tokens, or URLs with query strings.

## Known limitations in 1.0.x

These are tracked and scheduled; they are listed so nobody is surprised.

- The session cookie is stored with `electron-store`'s `encryptionKey`
  option, keyed from the install id. That is obfuscation, not encryption:
  anything that can read `userData` can read both files. The next release
  moves the cookie to the OS keychain through Electron's `safeStorage`
  (see ADR-002).
- On Windows, DPAPI-backed storage protects against other users on the
  machine, not against other software running as the same user. That is
  a platform property, and it applies to every app that stores a
  credential this way.
- On Linux, `safeStorage` depends on a keyring (GNOME Keyring or KWallet).
  Without one, Electron falls back to a hardcoded key; the app will refuse
  to persist a credential in that case rather than write it in the clear.
- The embedded login window presents a desktop Chrome user agent so that
  Google's sign-in accepts it. That is a workaround under review (see
  ADR-003); a credential file written by the vendor's own CLI is the
  planned default path.
- Renderer hardening (content security policy without inline scripts,
  sandbox on every window, a typed IPC surface) lands in the next release.

## Supply chain

Releases are built only in GitHub Actions from a tag on `main`. Every
action is pinned to a commit SHA, workflows run with least privilege,
the lockfile is linted for registry hosts and integrity, and `npm audit
signatures` verifies registry signatures on every CI run. CodeQL and
OpenSSF Scorecard run on a schedule. Signed and notarized installers with
build provenance are on the roadmap; until then, verify the checksum
listed on the release.
