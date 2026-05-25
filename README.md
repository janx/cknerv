# cknerv

Chain-generic visualization core for CKB. Extracted from
`ckb-rcg/simulator/` to serve both the RCG simulator and a future
standalone live-chain "weather station" (Phase C).

**Status:** v0.1 — scaffolding only. Phase B extraction in progress
(see `ckb-rcg/docs/superpowers/specs/2026-05-22-cknerv-extraction-design.md`).

## Layout

- `crates/cknerv-core/` — chain-generic types, `Mutation` enum, `Projection` trait, `helix_seed` (Rust + TS parity-tested)
- `crates/cknerv-server/` — axum HTTP/WS server + `Adapter` trait + entity store
- `crates/cknerv-adapter-ckb/` — placeholder (Phase C: CKB JSON-RPC adapter)
- `crates/cknerv-adapter-ckbadger/` — placeholder (Phase C: ckbadger adapter)
- `packages/types/` — `@cknerv/types`, TS mirror of `cknerv-core` wire types
- `packages/cache/` — `@cknerv/cache`, WS client + reducers
- `packages/ui/` — `@cknerv/ui`, React + R3F primitives
- `tests/fixtures/` — cross-language JSON fixtures (helix_seed, mutation samples, snapshots)

## Build + Test

```bash
cargo test --all                 # Rust workspace
pnpm install                     # Install JS deps + link workspace packages
pnpm test                        # TS workspace
pnpm build                       # TS package builds
```

## License

GPL-3.0 — see LICENSE.
