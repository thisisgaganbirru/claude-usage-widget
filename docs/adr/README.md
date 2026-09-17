# Architecture decision records

One file per decision, numbered, never edited after acceptance. A reversed
decision gets a new record that supersedes the old one. Each record has a
status (Proposed, Accepted, Superseded), the context that forced a choice,
the decision, and the consequences we accept.

| ADR                                                   | Status   | Decision                                             |
| ----------------------------------------------------- | -------- | ---------------------------------------------------- |
| [0001](0001-electron-over-tauri.md)                   | Accepted | Stay on Electron for v2.0, revisit Tauri afterwards  |
| [0002](0002-safestorage-over-electron-store-key.md)   | Accepted | Credentials go through `safeStorage`, not a store key |
| [0003](0003-user-agent-and-vendor-endpoint-policy.md) | Proposed | How the app identifies itself to each vendor         |
| [0004](0004-typed-ipc-api-over-channel-bridge.md)     | Accepted | A typed preload API replaces the generic channel bridge |
