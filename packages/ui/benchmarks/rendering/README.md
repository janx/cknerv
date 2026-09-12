# Rendering CPU benchmark

Run from the repository root:

```bash
pnpm -F @cknerv/ui benchmark:rendering
```

To print only the commit/dirty/source fingerprint without constructing the
benchmark fields:

```bash
CKNERV_BENCH_METADATA_ONLY=1 pnpm -F @cknerv/ui benchmark:rendering
```

The command bundles production TypeScript into `/tmp` and prints one JSON
object per scenario.

`--loader:.woff2=empty` is part of that bundle step and is not optional. The
inspection scenarios reach `hud/cellConstellationFrame.ts`, which reaches
`hud/hudTheme.ts`, which imports the seven hand-subset HUD faces as asset URLs
— a Vite/Rollup affordance esbuild has no loader for, so without the flag the
bundle fails with seven `No loader is configured for ".woff2" files` errors and
the benchmark cannot run at all. `empty` is the right loader rather than
`dataurl` or `file`: the URLs are only interpolated into an `@font-face` string
this benchmark never evaluates, and embedding a quarter-megabyte of font in a
CPU harness would measure the bundler. Any new module the benchmark's import
graph reaches that brings a non-code asset with it needs its own loader here.

The harness uses deterministic synthetic Cells only to isolate CPU
algorithms; it does not create a DOM, WebGL context, or second Canvas. Topology
preparation and warm-up are reported separately from timed samples. Run CPU
benchmarks serially with other heavy work stopped.

Every row carries the HEAD commit plus a dirty flag and SHA-256 fingerprint of
the UI/application source used for that run. The inspection cases report both
fixed-anchor landing and a 120-frame continuously moving anchor, including
current-anchor landings, longest stale run, settle frames, cursor cancellation,
forced catch-up, and maximum slice time.

The default sizes are 12,000 and 50,000 Cells. For a quick development pass,
set `CKNERV_BENCH_SIZES=12000`. These results are wall-clock CPU samples, not
browser FPS or GPU timing. Browser traces and hardware GPU measurements remain
part of the manual S6 matrix in `ui-app/VISUAL_REVIEW.md`.
