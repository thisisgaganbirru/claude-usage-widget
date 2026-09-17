# ADR-0004: A typed preload API over a generic channel bridge

Status: Accepted (2026-09)

## Context

The preload script in 1.0 exposes `invoke(channel, ...args)`, `send` and
`on` with an allowlist of channel names. The renderer can therefore call
any allowed channel with any payload, and a compromised renderer (a
cross-site script through a vendor string, a bad dependency) has the whole
allowlist at its disposal. Main-process handlers do not check which frame
sent a message and do not validate payload shapes. Electron's security
guide lists both as things not to do.

## Decision

The preload exposes one object, `window.api`, whose methods are named
operations with typed arguments and results (for example
`api.settings.update(patch)`, `api.usage.refresh()`,
`api.usage.onUpdate(callback)`). The `IpcApi` type is shared between
preload and renderer so the compiler checks both sides. Channel names stay
in `src/shared/ipc-channels.ts` and are used only inside preload and main.

In main, handlers are registered on `mainWindow.webContents.ipc` rather
than the global `ipcMain`, so no other web contents can reach them. Every
handler checks `event.senderFrame` is non-null and that its origin is the
app's own origin, then validates the payload with a schema before acting.
Event callbacks handed to the renderer never receive the raw
`IpcRendererEvent`.

## Consequences

- Adding an operation means touching the type, the preload, and the
  handler. That is three edits instead of one, and it is the point.
- The lint guard that rejects channel string literals outside the two
  allowed files stays, and gains a rule that rejects `ipcRenderer` use
  outside preload.
- A schema library is needed in main for payload validation; the choice
  of library is a dependency decision recorded in the PR that adds it.
