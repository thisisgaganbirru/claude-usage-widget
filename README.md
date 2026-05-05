# Claude Usage Widget

A real-time Claude API usage desktop widget for Windows. Displays your 5-hour session and 7-day usage at a glance from the system tray.

## Features

- **Three View Sizes** — Small (mini bar), Medium (compact), Large (expanded with model breakdown)
- **60-Second Auto-Refresh** — Automatic polling with configurable interval (30–300s)
- **Session & Weekly Countdown** — Live countdown to 5-hour session reset and 7-day weekly reset
- **Color-Coded Progress Bars** — Opus (orange), Sonnet (blue), Haiku (green) model breakdown
- **Pin to Top** — Always-on-top mode that floats above all windows including fullscreen apps
- **Click-Through Transparent Areas** — Mouse events pass through to apps behind the widget
- **System Tray Integration** — Lives in the system tray; click to show/hide
- **Keep in Tray** — Closing the widget hides it to tray instead of quitting (configurable)
- **Quick Entry Shortcut** — Global keyboard shortcut (`Ctrl+Alt+Space` default) to show widget from anywhere
- **Threshold Alerts** — Desktop notifications + in-widget banner at configurable usage levels (session + weekly)
- **Settings Panel** — Configure polling interval, alerts, startup, tray behavior, and shortcut
- **Secure Authentication** — Embedded browser login via Claude.ai (no password stored)
- **Session Persistence** — Login persists across restarts (30-day session)
- **Auto-start on Login** — Launches automatically on Windows startup (production build)

## Views

### Small (Mini)

- Compact single-card view (350×80px)
- Current session % used + progress bar
- Shows "Starts when a message is sent" when no active session
- Shows "Resets in X hr Y min" when session is active
- Shows error hint if API returns unexpected reset time

### Medium (Compact)

- Full session + weekly usage breakdown
- Model usage bars (Opus / Sonnet / Haiku)
- 7-day countdown timer

### Large (Expanded)

- Detailed per-model usage with individual progress bars
- Alert threshold toggles (50%, 75%, 90%, 95%) directly in-widget
- Weekly reset label and full countdown
- Quick links to Open Claude and Claude Settings

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **React 18** — UI
- **TypeScript 5** — Type-safe development
- **Tailwind CSS** — Styling (no inline styles)
- **Zustand** — State management
- **electron-store** — Encrypted local storage
- **Electron Forge** — Build & packaging

## Getting Started

### Prerequisites

- Node.js LTS only — **18.x, 20.x, or 22.x** (odd versions like 19, 21, 23, 25 are not supported)
- A Claude.ai account (Free, Pro, or Max)

### Development

```bash
# Install dependencies (use npm ci — respects the lock file exactly)
npm ci

# Start development server (hot reload)
npm start

# Type-check
npm run typecheck

# Lint (type-check + guard checks)
npm run lint

# Create production installer
npm run make
```

### Production Build

The installer is output to `out/make/` after `npm run make`.

## Usage

1. **Launch** — Run the installer or `npm start`
2. **Login** — Click "Login with Claude" and authenticate on Claude.ai
3. **View usage** — Widget shows session usage, countdown, and model breakdown
4. **Switch size** — Click `⋯` menu → choose Small / Medium / Large
5. **Pin/Unpin** — Click the pin button in the header to toggle always-on-top
6. **Quick entry** — Press `Ctrl+Alt+Space` (default) to show the widget from anywhere
7. **Tray** — Click the Claude tray icon (bottom-right) to show/hide the widget

## Architecture

### Three-Process Model

**Main Process** (`src/main/`)

- `index.ts` — App lifecycle, window creation, tray, IPC handlers (resize, move, pin, mouse passthrough, keepInTray)
- `tray.ts` — System tray with dynamic usage icons (4 states: normal / medium / warning / critical)
- `auth/login-window.ts` — Embedded BrowserWindow for Claude.ai login
- `auth/session-manager.ts` — Encrypted session cookie storage (per-install UUID, 30-day TTL)
- `data/usage-fetcher.ts` — API fetch via `electron.net` (bypasses Cloudflare)
- `data/usage-fetcher-errors.ts` — Typed error classes
- `data/usage-poller.ts` — EventEmitter-based polling with exponential backoff
- `ipc/handlers.ts` — IPC handlers for auth, usage, poller, settings, global shortcuts
- `settings/settings-manager.ts` — WidgetSettings CRUD via electron-store

**Renderer Process** (`src/renderer/`)

- `App.tsx` — Root component; handles view switching, mouse passthrough toggle
- `components/auth/LoginView.tsx` — Login screen with step feedback and diagnostics
- `components/widget/MiniView.tsx` — Small view
- `components/widget/CompactView.tsx` — Medium view
- `components/widget/ExpandedView.tsx` — Large view with threshold toggles
- `components/widget/WidgetHeader.tsx` — Draggable header with pin toggle and menu trigger
- `components/widget/WidgetMenu.tsx` — Dropdown menu (size, sign out, remove)
- `components/widget/AlertBanner.tsx` — Threshold alert banner
- `components/settings/SettingsPanel.tsx` — Settings panel (4 tabs)
- `store/` — Zustand stores (auth, usage)
- `hooks/useUsageData.ts` — IPC listener hook

**Preload** (`src/preload/preload.js`)

- Allowlist-based IPC bridge (invoke + send + on channels)
- Fetches channel list dynamically from main with static fallback
- Exposes `window.electron.ipcRenderer`

**Shared** (`src/shared/`)

- `ipc-channels.ts` — All IPC channel name constants
- `types.ts` — Shared TypeScript types

### Mouse Passthrough

Transparent areas around the widget card pass mouse events through to underlying apps via `setIgnoreMouseEvents(true, { forward: true })`. A `mousemove` listener in `App.tsx` toggles this only when state changes (entering/leaving `[data-widget-card]` or `[data-widget-menu]`), preventing flickering.

### Session Reset Logic (MiniView)

| `resetTime` value             | Shown                                               |
| ----------------------------- | --------------------------------------------------- |
| `null`                        | "Starts when a message is sent"                     |
| <= 5 hours away               | "Resets in X hr Y min"                              |
| > 5 hours away (API fallback) | "Something's off — try restarting the widget" (red) |

### API Transport

- **Transport**: `electron.net` (NOT fetch/axios — required for Cloudflare bypass and shared session cookies)
- **Response**: JSON with `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `extra_usage` objects

## Security

- `contextIsolation: true`, `sandbox: true` — Renderer isolated from main process
- Preload allowlist — only approved IPC channels exposed
- No passwords stored — auth via Claude.ai embedded browser only
- Encrypted sessions — electron-store encrypts cookies at rest using a per-install UUID key
- `app:openExternal` restricted to `https://claude.ai/` prefix only

## Troubleshooting

**`EBADENGINE` error on `npm ci`**
→ You're on an unsupported Node.js version. Install Node.js LTS (18, 20, or 22) from nodejs.org and retry.

**Widget not visible after launch**
→ Check system tray (bottom-right `^` hidden icons), click the Claude icon

**Usage not updating**
→ Click `⋯` → the poller refreshes on next interval, or use Refresh in the tray menu

**Session expired**
→ Widget auto-detects 401/403 and shows login screen

**Surrounding area blocking other apps**
→ Fixed via `setIgnoreMouseEvents` passthrough — restart widget if issue persists

**Global shortcut not working**
→ Another app may have claimed that key combination. Change it in Settings → General → Quick Entry.

## Roadmap

### Phase 1 (Complete)

- [x] Embedded browser authentication
- [x] Live usage polling (5-hour + 7-day)
- [x] Three view sizes (Small / Medium / Large)
- [x] System tray integration with dynamic usage icons
- [x] Pin to top (always-on-top toggle)
- [x] Mouse click-through for transparent areas
- [x] Model breakdown (Opus / Sonnet / Haiku)
- [x] Auto-start on Windows login

### Phase 2 (Complete)

- [x] Threshold notifications (50%, 75%, 90%, 95%) — desktop + in-widget
- [x] Settings UI (polling interval, notifications, startup, tray, shortcut)
- [x] Keep in tray on close (configurable)
- [x] Global quick-entry keyboard shortcut

### Phase 3

- [ ] Theme support (light / dark / auto) — stored, not yet applied
- [ ] Usage history graph (7-day)
- [ ] Multi-account support
- [ ] macOS / Linux testing
- [ ] Auto-updater
- [ ] Code signing for distribution

## License

MIT © [Gagansai Birru](https://github.com/thisisgaganbirru)

See [LICENSE](./LICENSE) for full text.
