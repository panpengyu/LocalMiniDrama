# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

LocalMiniDrama (本地短剧助手) — an AI-powered local short drama creation tool. Single product, three sub-projects sharing one repo (npm workspaces).

### Services

| Service | Directory | Port | Start Command |
|---------|-----------|------|---------------|
| Backend (Express + MySQL) | `backend-node/` | 5679 | `npm run dev` |
| Frontend - User (Vite + Vue 3) | `front-user/` | 3013 | `npm run dev` |
| Frontend - Admin (Vite + Vue 3) | `front-admin/` | 3014 | `npm run dev` |

Both frontends proxy `/api` and `/static` to backend via Vite config. Shared code is in `packages/shared/` (@localmini/shared).

### Running Tests

```bash
# Backend tests (Node.js built-in test runner)
cd backend-node && node --test test/*.test.js
```

No ESLint or other lint tool is configured in this codebase.

### Building

```bash
# Build both frontends
npm run build:all

# Or build individually
npm run build:user   # front-user
npm run build:admin  # front-admin
```

### Key Development Notes

- Pure JavaScript (no TypeScript) throughout.
- Backend uses `node --watch` for hot reloading in dev mode (`npm run dev`).
- Database is SQLite (embedded via `better-sqlite3`), auto-created in `backend-node/data/`.
- Migrations run automatically on backend startup (`ensureColumns()`); explicit `npm run migrate` only needed for first-time setup or after adding new migration SQL files.
- Config file at `backend-node/configs/config.yaml` already exists in the repo — no need to copy from example.
- AI content generation requires external API keys (configured via the app's "AI 配置" page), but the app fully functions without them for development/testing purposes.
- The backend also serves the built user frontend from `front-user/dist/` at port 5679 when the dist folder exists; during development, use the Vite dev server at port 3013 (user) or 3014 (admin) instead.
