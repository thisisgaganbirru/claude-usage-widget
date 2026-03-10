# Claude Usage Widget

A real-time Claude API usage desktop widget for Windows. Displays your 5-hour session and 7-day usage at a glance from the system tray.

## Features

- 📊 **Three View Sizes** — Small (mini bar), Medium (compact), Large (expanded with model breakdown)
- 🔄 **60-Second Auto-Refresh** — Automatic polling with configurable interval (30–300s)
- ⏱️ **Session & Weekly Countdown** — Live countdown to 5-hour session reset and 7-day weekly reset
- 🎨 **Color-Coded Progress Bars** — Opus (orange), Sonnet (blue), Haiku (green) model breakdown
- 📌 **Pin to Top** — Always-on-top mode that floats above all windows including fullscreen apps
- 🖱️ **Click-Through Transparent Areas** — Mouse events pass through to apps behind the widget
- 🪟 **System Tray Integration** — Lives in the system tray; click to show/hide
- 🔐 **Secure Authentication** — Embedded browser login via Claude.ai (no password stored)
- 💾 **Session Persistence** — Login persists across restarts (30-day session)
- 🚀 **Auto-start on Login** — Launches automatically on Windows startup (production build)

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
- Detailed per-model usage
- Weekly reset label
- Full stats breakdown

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **React 18** — UI
- **TypeScript 5** — Type-safe development
- **Tailwind CSS** — Styling
- **Zustand** — State management
- **electron-store** — Encrypted local storage
- **Electron Forge** — Build & packaging

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Claude.ai account (Free, Pro, or Max)

### Development

```bash
# Install dependencies
npm install

# Start development server (hot reload)
npm start

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
5. **Pin/Unpin** — Click `⋯` menu → "Pin to top" / "Unpin from top"
6. **Tray** — Click the Claude tray icon (bottom-right) to show/hide the widget

## Architecture

### Three-Process Model

**Main Process** (`src/main/`)
- `index.ts` — App lifecycle, window creation, tray, IPC handlers (resize, move, pin, mouse passthrough)
- `tray.ts` — System tray with dynamic usage icons
- `auth/login-window.ts` — Embedded BrowserWindow for Claude.ai login (always centers on screen)
- `auth/session-manager.ts` — Encrypted session cookie storage
- `data/usage-fetcher.ts` — API fetch via `electron.net` (bypasses Cloudflare)
- `data/usage-poller.ts` — EventEmitter-based 60s polling
- `ipc/handlers.ts` — IPC handlers for auth, usage, poller, settings

**Renderer Process** (`src/renderer/`)
- `App.tsx` — Root component; handles view switching, mouse passthrough toggle
- `components/widget/MiniView.tsx` — Small view
- `components/widget/CompactView.tsx` — Medium view
- `components/widget/ExpandedView.tsx` — Large view
- `components/widget/WidgetHeader.tsx` — Draggable header with `⋯` menu trigger
- `components/widget/WidgetMenu.tsx` — Dropdown menu portal
- `store/` — Zustand stores (auth, usage)
- `hooks/useUsageData.ts` — IPC listener hook

**Preload** (`src/preload/preload.js`)
- Whitelist-based IPC bridge (invoke + send channels)
- Exposes `window.electron.ipcRenderer`

### Mouse Passthrough

Transparent areas around the widget card pass mouse events through to underlying apps via `setIgnoreMouseEvents(true, { forward: true })`. A `mousemove` listener in `App.tsx` toggles this only when state changes (entering/leaving `[data-widget-card]` or `[data-widget-menu]`), preventing flickering.

### Session Reset Logic (MiniView)

| `resetTime` value | `sessionActive` | Shown |
|---|---|---|
| `null` | `false` | "Starts when a message is sent" |
| ≤ 5 hours away | `true` | "Resets in X hr Y min" |
| > 5 hours away (API fallback) | `false` (error) | "Something's off — try restarting the widget" (red) |

### API Endpoint

- **URL**: `https://claude.ai/api/organizations/{orgId}/usage`
- **Transport**: `electron.net` (NOT axios — required for Cloudflare bypass)
- **Response**: JSON with `five_hour` and `seven_day` usage objects

## Security

- `contextIsolation: true` — Renderer isolated from main process
- Preload whitelist — only approved IPC channels exposed
- No passwords stored — auth via Claude.ai directly
- Encrypted sessions — electron-store encrypts cookies at rest

## Troubleshooting

**Widget not visible after launch**
→ Check system tray (bottom-right `^` hidden icons), click the Claude icon

**Usage not updating**
→ Click `⋯` → the poller refreshes on next interval, or quit and relaunch

**Session expired**
→ Widget auto-detects 401/403 and shows login screen

**Surrounding area blocking other apps**
→ Fixed via `setIgnoreMouseEvents` passthrough — restart widget if issue persists

## Roadmap

### Phase 1 ✅ (Current)
- [x] Embedded browser authentication
- [x] Live usage polling (5-hour + 7-day)
- [x] Three view sizes (Small / Medium / Large)
- [x] System tray integration
- [x] Pin to top
- [x] Mouse click-through for transparent areas
- [x] Model breakdown (Opus / Sonnet / Haiku)
- [x] Auto-start on Windows login

### Phase 2
- [ ] Usage history graph (7-day)
- [ ] Threshold notifications (50%, 75%, 90%, 95%)
- [ ] Settings UI (polling interval, notifications)
- [ ] Multi-account support

### Phase 3
- [ ] macOS / Linux testing
- [ ] Auto-updater
- [ ] Code signing for distribution

## License

MIT

