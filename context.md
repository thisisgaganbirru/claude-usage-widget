# AGENTS.md - Master Reference

**Note: This file is the master reference for all .md context files via symlinks.**

## 1. Tech Stack & Architecture
- **Architecture:** Electron Multi-Process (Main, Preload, Renderer)
- **Frameworks:** Electron 40.1, React 18.2, TypeScript 5.3
- **Styling:** Tailwind CSS 3.4
- **State Management:** Zustand 4.4
- **Build Tool:** Webpack via Electron Forge 7.11

## 2. Directory Map
- `src/main/` - Electron main process (tray, preferences, data fetchers, IPC).
- `src/renderer/` - React application (components, hooks, stores).
- `src/preload/` - Preload scripts for IPC bridge security.
- `src/shared/` - Shared typings between main and renderer.
- `assets/` - Application icons and static assets.

## 3. Core Commands (Dynamic)
Inspect `package.json` for script execution:
- **Install:** `npm install` (via `package-lock.json`)
- **Dev/Start:** `npm run start` (runs `electron-forge start`)
- **Type-Check:** `npx tsc --noEmit` (TypeScript configured, script absent)
- **Lint:** `npm run lint` (currently disabled/unconfigured in `package.json`)

## 4. Coding Standards
- **Naming:** PascalCase for React components (`App.tsx`), kebab-case for other files (`usage-fetcher.ts`).
- **State Management:** Zustand stores located in `src/renderer/store/`.
- **UI Components:** Functional React components located in `src/renderer/components/`.

## 5. Anti-Patterns (The "NEVER" List)
- NEVER use default exports; use named exports only.
- NEVER add new dependencies without explicit approval.
- NEVER use 'try/catch' around API calls if a global wrapper exists.
- NEVER use inline styles; use Tailwind CSS exclusively.
- NEVER commit `.env` files or hardcode secrets.

## 6. Domain Logic (Core Files)
1. `src/main/data/` (`usage-fetcher.ts`, `usage-poller.ts`) - Core business logic for API data fetching.
2. `src/main/ipc/handlers.ts` - Central communication bridge between main and renderer.
3. `src/renderer/store/` - UI state management for auth and usage metrics.
