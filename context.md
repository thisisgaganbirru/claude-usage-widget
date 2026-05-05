# AGENTS.md - Master Reference

**Note: This file is the master reference for all .md context files via symlinks.**

## 1. Tech Stack & Architecture
- **Architecture:** Electron Multi-Process (Main, Preload, Renderer)
- **Frameworks:** Electron 40.1, React 18.2, TypeScript 5.3
- **Styling:** Tailwind CSS 3.4 (never inline styles — Tailwind only)
- **State Management:** Zustand 4.4
- **Build Tool:** Webpack via Electron Forge 7.11
- **Storage:** electron-store (encrypted session, settings, install ID)

## 2. Directory Map

`src/main/` — Electron main process
- `index.ts` — App lifecycle, window creation, IPC setup (resize, pin, mouse passthrough, keepInTray)
- `tray.ts` — System tray with 4 usage-level icons + context menu
- `browser-preference.ts` — Browser preference helper (IPC-exposed)
- `auth/login-window.ts` — Embedded BrowserWindow login flow (cookie capture)
- `auth/session-manager.ts` — Encrypted session storage (per-install UUID, 30-day TTL)
- `data/usage-fetcher.ts` — Claude.ai API fetch via electron.net + multi-format parsing
- `data/usage-fetcher-errors.ts` — Typed error classes (UsageFetchError, UsageFetchErrorType)
- `data/usage-poller.ts` — EventEmitter polling loop with exponential backoff
- `ipc/handlers.ts` — All IPC handler registrations + global shortcut management
- `settings/settings-manager.ts` — WidgetSettings CRUD via electron-store

`src/renderer/` — React application
- `App.tsx` — Root router: auth/settings/view switching + mouse passthrough toggle
- `hooks/useUsageData.ts` — IPC event subscriptions + Zustand store bridge
- `store/auth-store.ts` — Zustand auth state (isAuthenticated, checkSession)
- `store/usage-store.ts` — Zustand usage state + fetchCurrent
- `components/auth/LoginView.tsx` — Login prompt (800×600), step states, diagnostics copy
- `components/widget/MiniView.tsx` — Small view (350×80)
- `components/widget/CompactView.tsx` — Medium view (350×345)
- `components/widget/ExpandedView.tsx` — Large view (350×650)
- `components/widget/WidgetHeader.tsx` — Draggable header, pin toggle, menu trigger
- `components/widget/WidgetMenu.tsx` — Dropdown: size switch, sign out, sign out everywhere, remove
- `components/widget/AlertBanner.tsx` — Blinking threshold alert banner
- `components/widget/Footer.tsx` — Last-updated timestamp + refresh button
- `components/settings/SettingsPanel.tsx` — Settings (800×600), 4 tabs: General, Alerts, Appearance, About

`src/preload/preload.js` — Channel-allowlisted contextBridge IPC bridge
`src/shared/ipc-channels.ts` — All IPC channel name constants (source of truth)
`src/shared/types.ts` — Shared TypeScript types (UsageData, WidgetSettings, etc.)
`assets/` — App and tray icons (4 tray states)
`scripts/lint-guards.mjs` — Custom lint guard checks (runs as part of `npm run lint`)

## 3. Core Commands
- **Install:** `npm ci` (preferred — respects lock file exactly)
- **Dev/Start:** `npm run start` (runs `electron-forge start`)
- **Type-Check:** `npm run typecheck` (runs `tsc --noEmit`)
- **Lint:** `npm run lint` (runs `npm run typecheck && node scripts/lint-guards.mjs`)
- **Check:** `npm run check` (alias for `npm run lint`)
- **Build:** `npm run make` (production installer → `out/make/`)

## 4. Coding Standards
- **Naming:** PascalCase for React components (`App.tsx`), kebab-case for other files (`usage-fetcher.ts`)
- **Exports:** Named exports only — never default exports
- **State Management:** Zustand stores in `src/renderer/store/`
- **IPC Channels:** Always use constants from `src/shared/ipc-channels.ts` — never hardcode strings
- **Styling:** Tailwind CSS exclusively — never inline styles

## 5. Anti-Patterns (The "NEVER" List)
- NEVER use default exports; use named exports only
- NEVER add new dependencies without explicit approval
- NEVER use try/catch around IPC calls if a global wrapper exists
- NEVER use inline styles; use Tailwind CSS exclusively
- NEVER commit `.env` files or hardcode secrets

## 6. Domain Logic

### Auth
- **`login-window.ts`** — Opens embedded BrowserWindow to `claude.ai/login`. Detects login via: real-time `cookies.on('changed')` + 1s polling + navigation events. Google OAuth popup intercepted via `setWindowOpenHandler` with `action:"allow"` to preserve `window.opener`. Captures the first matching cookie from `SESSION_COOKIE_KEYS`.
- **`session-manager.ts`** — Encrypts cookie with per-install UUID (`crypto.randomUUID`, `install-id` store). 30-day TTL. `SESSION_COOKIE_KEYS` is the canonical list: `sessionKey`, `sessionKeyV2`, `CH_SESSION`, `__Secure-next-auth.session-token`, `next-auth.session-token`.
- On 401/403: `SessionManager.clearSession()` + emit `authExpired` → renderer shows `LoginView`.
- Soft logout: session store only. Hard logout: session store + all `claude.ai` browser cookies.

### Data
- **`usage-fetcher.ts`** — Fetches `https://claude.ai/api/organizations/{id}/usage` via `electron.net`. Org ID fetched once from `/api/organizations`, cached in-process, cleared on logout. Primary parser: `extractFromUsageEndpoint()` (reads `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `extra_usage`). Falls back through RSC wire format → HTML `__next_f` flight data. Scraping stub always throws (not implemented).
- **`usage-poller.ts`** — EventEmitter subclass. Emits: `usageUpdate`, `thresholdCrossed`, `authExpired`, `pollError`. Exponential backoff on transient errors (5s base, max 5min). Checks session and weekly thresholds each poll from `SettingsManager.get()`.

### IPC
- **`ipc-channels.ts`** — Three groups: `IPC_INVOKE_CHANNELS` (request-response), `IPC_ON_CHANNELS` (push from main), `IPC_SEND_CHANNELS` (fire-and-forget).
- **`handlers.ts`** — Registers all `ipcMain.handle()` and poller event forwarding. Manages `globalShortcut` for `quickEntryShortcut` setting. `cleanupGlobalShortcuts()` is called on `will-quit`.
- **`preload.js`** — Fetches allowed channel lists dynamically from main (`ipc:getChannels`) with static fallback. Strips Electron `event` arg from listener callbacks. Wraps listeners in WeakMap for correct `removeListener` support.

### Settings (WidgetSettings in `src/shared/types.ts`)
| Field | Default | Notes |
|---|---|---|
| `pollingInterval` | `60` | seconds, clamped 30–300 |
| `notificationThresholds` | `[50,75,90,95]` | session alert % levels |
| `weeklyNotificationThresholds` | `[50,75,90,100]` | weekly alert % levels |
| `enableNotifications` | `true` | desktop + in-widget alerts |
| `startOnBoot` | `false` | production only; uses `app.setLoginItemSettings` |
| `keepInTray` | `true` | hide to tray on close instead of quitting |
| `quickEntryShortcut` | `"Control+Alt+Space"` | global shortcut to show widget |
| `theme` | `"auto"` | stored and shown in UI, not yet applied to renderer |

### Widget Views
| Size | Dimensions | Component | Content |
|---|---|---|---|
| Small | 350×80 | `MiniView` | Session progress bar, reset countdown hint |
| Medium | 350×345 | `CompactView` | Session + weekly + stacked model bar + countdown |
| Large | 350×650 | `ExpandedView` | All above + per-model breakdown + threshold toggles |
| Settings | 800×600 | `SettingsPanel` | General, Alerts, Appearance, About tabs |
| Login | 800×600 | `LoginView` | Login prompt, step feedback, diagnostics |

Window resizing is driven by `App.tsx` via `invoke("resize-window", w, h)`.

### Mouse Passthrough
Transparent areas pass mouse events through via `setIgnoreMouseEvents(true, { forward: true })`. `App.tsx` toggles this only on state change (entering/leaving `[data-widget-card]` or `[data-widget-menu]`) using `elementFromPoint` on `mousemove`.

### Tray Icon States
| Usage % | Icon file |
|---|---|
| 0–49% | `tray.png` |
| 50–74% | `tray-medium.png` |
| 75–89% | `tray-warning.png` |
| 90–100% | `tray-critical.png` |

## 7. CI
- `quality.yml` — Runs `npm run lint` on push/PR to `main` and `dev` (windows-latest runner)
- `release.yml` — Gates releases to main-branch tags only
