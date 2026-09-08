# AGENTS.md

Operational instructions for AI agents working in this repository. Read
`README.md` first; it carries the project overview, the quick start, and an
index of the documents under `docs/`, which hold everything else:
`docs/development.md` for the checkout workflow, build gate, tech stack,
repository layout, persistence, and known limits, `docs/architecture.md` for
the design contract, `docs/api.md` for the wire shapes, and
`docs/configuration.md` for `cknerv.toml`.

## Project Summary

cknerv is a local-first CKB chain visualization stack:

- Rust crates ingest read-only CKB JSON-RPC data, reduce it into
  chain-generic mutations, serve snapshots/deltas over HTTP/WS, and persist
  derived dashboard state.
- TypeScript packages mirror the Rust wire types, maintain reducer caches, and
  render the React Three Fiber cell-galaxy UI.
- `ui-app/` is the default dashboard embedded into the `cknerv` CLI binary.

## Project Principles

- **CKB Native**: make CKB's cell model visible. Chain data is the only source
  of truth; cells, links, HUD values, and pulses are derived from real blocks,
  transactions, and outpoints.
- **Local First**: optimize for a local node plus a local dashboard, with a
  local ckbadger beside them for the full version. Avoid adding hosted-service
  assumptions or middleware dependencies to either path.
- **Agent Friendly**: keep wire shapes, routes, fixtures, commands, and
  verification paths explicit enough for automated agents to inspect and extend
  safely.

Chain-genericity is no longer a stated principle, but it remains the built
structure: source-specific code lives behind adapters, and the server,
projections, cache reducers, and UI stay driven by mutations and snapshots.
Keep it that way unless a change deliberately retires it.

**Principle Sync Rule**: if project principle wording changes, update both
`README.md` and `AGENTS.md` in the same change.

## Agent Task Template

For any non-trivial task summary or PR description, use this shape:

```md
## Goal

- What problem is being solved

## Principle Alignment

- Which cknerv boundary or principle the change preserves

## Result

- Behavior or documentation change summary
- State/purge required: yes/no
- What to do next
```

## Non-Negotiable Boundaries

- Keep `cknerv-core` chain-generic. Do not introduce CKB RPC, axum, React, or
  adapter-specific logic there.
- Keep `cknerv-server` source-agnostic. It owns adapters as a trait boundary,
  projection dispatch, streams, and persistence; it should not know CKB RPC
  details.
- Keep CKB-specific ingestion in `crates/cknerv-adapter-ckb/` and CLI wiring in
  `crates/cknerv-cli/`.
- Keep UI packages browser-facing. They should consume `@cknerv/types` and
  `@cknerv/cache`, not Rust internals or node RPC directly.
- cknerv must remain read-only against the CKB node. Do not add transaction
  submission or mutating RPC calls unless the user explicitly changes the
  product scope.

## Contracts To Keep In Sync

- Rust wire types in `crates/cknerv-core/` and TypeScript twins in
  `packages/types/`.
- Shared fixtures in `tests/fixtures/` and the Rust/TS parity tests that read
  them.
- Deterministic helix positioning in `crates/cknerv-core/src/helix.rs` and
  `packages/ui/src/helix.ts`.
- Config shape across `crates/cknerv-cli/src/config.rs`, the
  `CKNERV_TOML_TEMPLATE`, `ui-app/src/runtime-config.ts`, and
  `docs/configuration.md`.
- Server API route shapes consumed by `packages/cache/` and bootstrapped by
  `ui-app/src/main.tsx`.
- Persistence schema in `crates/cknerv-server/src/persistence.rs`; bump
  `SCHEMA_VERSION` for incompatible on-disk changes.
- README and AGENTS project principles; keep wording synchronized.

## Development Status

This is an actively developed project (workspace version 1.0.1). Local mode
is the default; `[dashboard].hosted` explicitly enables public read-only
viewing through an operator-managed HTTPS reverse proxy. The API has no
authentication or tenant isolation. Derived state can be purged and rebuilt
from the configured CKB node. Prefer simple, correct schema and projection design over
compatibility layers for stale local state. If a state shape changes
incompatibly, bump the persistence schema, document whether
`cknerv purge --confirm` is needed, and test bad-file/schema-mismatch behavior.

## Commands

Install workspace dependencies:

```bash
pnpm install --frozen-lockfile
```

Rust checks:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

TypeScript checks:

```bash
pnpm test
pnpm typecheck
```

Build the release CLI, including the embedded SPA:

```bash
cargo build --release -p cknerv-cli
```

For docs-only changes, at minimum run:

```bash
git diff --check
```

## Manual Runtime Smoke

Use this when changes touch `cknerv-cli`, `cknerv-server`,
`cknerv-adapter-ckb`, persistence, or the SPA boot path:

```bash
cargo build --release -p cknerv-cli
./target/release/cknerv run --no-open --port 17001
```

Then verify:

- `GET /api/entities/chain/snapshot` returns
  `{revision, chain, chain_nodes, peers}`.
- `GET /api/projections/cells/snapshot` returns `{revision, snapshot}` with
  `snapshot.cells`.
- The chain tip advances when the node advances.
- Ctrl-C persists `<workdir>/data/cknerv-state.json` and releases the port.

The longer manual checklist lives in `crates/cknerv-cli/SMOKE.md`.

## Development Rules

- Prefer focused changes. Avoid broad refactors unless they directly reduce
  risk for the requested work.
- Do not edit generated or heavy local artifacts: `target/`, `node_modules/`,
  `dist/`, `*.tsbuildinfo`, `.superpowers/`, `.aux/`, and `temp/`.
- Do not commit Superpowers workflow documents or local state. Keep
  `docs/superpowers/` and `.superpowers/` local-only even when tooling creates
  or updates files there.
- Preserve user work in the tree. Do not reset, checkout, or delete unrelated
  changes.
- Use existing module boundaries and test style before adding new abstractions.
- For correctness bugs, trace the upstream cause and fix the single canonical
  path. Avoid silent fallback calculation chains on wire/projection logic.
- Transient external failures are allowed only where the project already treats
  them as operational conditions, such as CKB polling warnings or best-effort
  persistence recovery.

## Testing Guidance

- If a mutation, entity, projection, or API shape changes, update both Rust and
  TypeScript tests plus `tests/fixtures/`.
- If `CellGalaxy` semantics change, test reducer/projection behavior on both
  sides where applicable.
- If UI behavior changes, add or update Vitest tests under the relevant
  package's `__tests__/` directory.
- If CLI config changes, test merge priority: CLI args over `cknerv.toml` over
  defaults.
- If persistence changes, test save/load, bad files, schema mismatch, and
  restored-tip behavior.

## Directory Map

| Path | Notes |
|---|---|
| `crates/cknerv-core/` | Chain-generic Rust types, mutations, projections, helix, ring buffer. |
| `crates/cknerv-server/` | axum server, adapter trait, routes, streams, projection registry, persistence. |
| `crates/cknerv-adapter-ckb/` | CKB JSON-RPC adapter, block fetch, backfill, content hash logic. |
| `crates/cknerv-cli/` | CLI, workdir/config commands, embedded SPA assets, server boot wiring. |
| `packages/types/` | TypeScript wire-type twins. |
| `packages/cache/` | Pure reducers and WebSocket stream helpers. |
| `packages/ui/` | React/R3F visual primitives, HUDs, geometry, materials, nerve overlay. |
| `ui-app/` | Default dashboard SPA embedded by the CLI. |
| `tests/fixtures/` | Shared fixtures for Rust/TS parity. |
