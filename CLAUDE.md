# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ioBroker.n8n is an ioBroker adapter that embeds n8n workflow automation directly into ioBroker as a service — no separate n8n instance required. It spawns n8n as a child process, manages its lifecycle, and provides custom n8n nodes for interacting with ioBroker states, objects, files, and logs.

## Build & Development Commands

```bash
# Install all dependencies (root + n8n-nodes-iobroker + src-iobroker frontend)
npm run npm

# Build everything (adapter TypeScript + n8n custom nodes)
npm run build

# Type-check only (no emit)
npm run check

# Lint (ESLint on src/ only — n8n-nodes-iobroker and src-iobroker are excluded)
npm run lint

# Run tests (package validation only)
npm run test

# Run package validation tests specifically
npm run test:package

# Run integration tests (builds first, then runs adapter with js-controller)
npm run test:integration

# Build n8n custom nodes separately
cd n8n-nodes-iobroker && npm run build

# Run frontend dev server (port 3000, proxies /adapter to localhost:8081)
cd src-iobroker && npm start
```

## Architecture

The project has three distinct codebases that compile independently:

### 1. Main Adapter (`src/` → `dist/`)
- **`src/main.ts`** — Single-file adapter (~1200 lines). Class `N8NAdapter extends Adapter`.
- Manages an Express web server (HTTP/HTTPS with certificate support via `@iobroker/webserver`).
- Spawns n8n as a child process, installs/updates it from npm into `<ioBroker-data-dir>/n8n/`.
- Provides Socket.io real-time communication via `@iobroker/socket-classes`.
- Serves static files from `public/` and proxies adapter admin routes.
- n8n version is pinned in root `package.json` devDependencies — dependabot updates it.
- TypeScript target: ES2022, module: Node16, strict mode. Types from `@iobroker/types`.

### 2. Custom N8N Nodes (`n8n-nodes-iobroker/` — separate package)
- **Has its own `package.json`, `tsconfig.json`, and dependency tree.** Built separately.
- Three node types registered via `n8n.nodes` in its package.json:
  - **IoBrokerTriggerNode** — triggers on state/object/file/log changes (supports wildcard patterns)
  - **IoBrokerReadNode** — reads states, objects, lists devices
  - **IoBrokerOutputNode** — writes states, objects, files, logs
- **`IobAdapter.ts`** — manages WebSocket subscriptions and device caching for the nodes.
- Communicates with the main adapter over WebSocket (`ws` package + `@iobroker/socket-client-backend`).

### 3. Admin Frontend (`src-iobroker/` — React + Vite)
- **Has its own `package.json` and build pipeline.** Uses `@iobroker/adapter-react-v5` + MUI 6.
- Builds to `src-iobroker/build/`. Dev server on port 3000.
- Adapter configuration UI is defined declaratively in `admin/jsonConfig.json` (not in this React app).

### Key Configuration Files
- **`io-package.json`** — ioBroker adapter metadata: default ports (n8n: 5678, service: 5680), native settings (ports, HTTPS, SMTP), adapter mode (daemon).
- **`admin/jsonConfig.json`** — declarative admin UI config schema (bind address, ports, certificates, SMTP).

## Testing

- **Mocha + Chai** for tests. `@iobroker/testing` for package validation, `@iobroker/legacy-testing` for integration.
- Integration tests have a 600s timeout — they start a full js-controller, boot the adapter, and check that n8n GUI responds on port 5678.
- CI runs on Node 20.x, 22.x, 24.x (Ubuntu).

## Key Constraints

- Node.js >= 20.19 required.
- ESLint config extends `@iobroker/eslint-config`. Linting only covers `src/` — `n8n-nodes-iobroker/` has its own linting setup.
- The `n8n-nodes-iobroker/` package uses `n8n-workflow` as a peer dependency.
- The root `tsconfig.json` is for editor type-checking only (`noEmit: true`). Actual compilation uses `tsconfig.build.json`.
