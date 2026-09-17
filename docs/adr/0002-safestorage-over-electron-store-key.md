# ADR-0002: safeStorage over electron-store's encryption key

Status: Accepted (2026-09)

## Context

Version 1.0 keeps the claude.ai session cookie in an `electron-store`
file with the `encryptionKey` option, and derives that key from a random
install id kept in a second file next to it. The store's own documentation
describes `encryptionKey` as obscurity, not security: anything that can
read the user data folder can read both files and recover the cookie.

Electron's `safeStorage` uses the platform's credential store: Keychain on
macOS, DPAPI on Windows, and the desktop keyring on Linux.

## Decision

All vendor credentials are encrypted with `safeStorage.encryptString` and
the ciphertext is written to a file with mode 0600. They are decrypted only
in the main process, at the moment of use. On Linux the module checks
`safeStorage.getSelectedStorageBackend()` and refuses to persist a
credential when the backend is `basic_text`, because that backend is a
hardcoded key.

Credential files written by a vendor's own CLI (for example
`~/.claude/.credentials.json`) are read in place and never copied.

## Consequences

- A decryption failure (keychain reset, user profile moved) means the user
  signs in again. It never crashes and never falls back to plaintext.
- On Windows, DPAPI protects against other users, not against other
  software running as the same user. This is stated in `SECURITY.md`.
- Linux users without a keyring get a clear message and no persisted
  credential.
- The `electron-store` dependency stays for settings, which are not
  secret.
