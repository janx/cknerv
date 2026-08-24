# HUD font subsets

`HuiwenMincho-subset.woff2` is a 32-glyph subset of 汇文明朝体
(`Huiwen-mincho`) for the Chinese text used by the HUD:

```text
共识基神经元脉搏节点场对端状态警告道样本细胞记录交易输入谱系见证
```

That list is exactly the glyphs rendered in `HUD_FONTS.cjk` today — the `cjk`
props of `PanelHeader` (including `StageCapacityPanel`'s 样本 and `CellsPanel`'s
神经元), `WarningBar`'s 警告, `StatusStrip`'s 状态, the inspector cards' title
companions (`PeerLinkCard`'s 对端, `NodeSelfCard`'s 节点, `CellDetailPanel`'s
细胞), and — the newest arrivals — the three consensus-memory endpoint markers
drawn over the stage by `nerve/ConsensusMemoryMarkers`: 共识记录, 交易输入,
谱系见证. (`SightedNodeCard` documents in-file why it deliberately wears none.)

Ten of those twelve marker glyphs were outside the 22-glyph subset this list
used to describe, and the markers asked for `JetBrains Mono Local` besides —
an ASCII face with no Chinese in it at all. Both halves have to be right: a
re-subset that leaves the element pointing at a Latin face fixes nothing, and
an element pointing at `HUD_FONTS.cjk` for a glyph the subset does not carry
falls through to whatever serif the machine happens to have. Neither failure
raises anything; the panel just looks slightly wrong to somebody who is not
looking for it. So re-subset in the same commit as the string — 样本 once
shipped a release ahead of this list, which is why the inventory is stated as
the whole truth rather than a delta, and `hudDiscipline.test.ts` now reads
every Chinese literal in the package rather than only the ones written as a
JSX prop.

The source font comes from the Chinese Webfont Project package
[`@chinese-fonts/hwmct`](https://github.com/KonghaYao/chinese-free-web-font-storage/tree/branch/packages/hwmct).
Its embedded copyright record is `Public Domain`. The npm tarball ships only
per-range woff2 shards; the full TTF lives in the repo at
`packages/hwmct/fonts/汇文明朝体.ttf` (24.4MB) on the `branch` branch.

Source file SHA-256:
`1ea5d0450c0d034c3e4077f2b533d74fbd1bf1f14d938477389338e64d3d8d9c`.

Regenerate with FontTools 4.63 or later:

```bash
pyftsubset /path/to/汇文明朝体.ttf \
  --text='共识基神经元脉搏节点场对端状态警告道样本细胞记录交易输入谱系见证' \
  --no-ignore-missing-unicodes \
  --flavor=woff2 \
  --output-file=HuiwenMincho-subset.woff2
```

The expected SHA-256 for the checked-in subset is
`9135dd0b2152092e1730905d620d599ce9a8f5b3875811341dae9a15b6e9f15f`.

## `JetBrains Mono Local` / `Orbitron Local`

`JetBrainsMono-400-subset.woff2` and `Orbitron-500-subset.woff2` back the two
families the in-scene labels name directly (`CellGalaxy`,
`ConsensusMemoryMarkers`, `ConsensusRouteHopMarker`, `hud/ConsensusMemory`).
Both upstream faces are SIL OFL 1.1. They replace the full 274KB/18KB TTFs that
used to ride into the bundle unregistered — the families resolved to
`ui-monospace` on any machine without the face installed locally.

Coverage is ASCII printable plus the symbols those labels render:

```text
· × – — • → ↗ ≈ ≤ ✓ ◇
```

Optional layout features are dropped on purpose: JetBrains Mono's programming
ligatures would otherwise fire inside a hex cell id. Orbitron ships Medium only
while the galaxy label asks for both 400 and 500, so its `@font-face` claims the
whole `400 500` span instead of letting the browser synthesize a bold.

Regenerate with FontTools 4.63 or later:

```bash
pyftsubset /path/to/JetBrainsMono-Regular.ttf \
  --unicodes=U+0020-007E,U+00B7,U+00D7,U+2013,U+2014,U+2022,U+2192,U+2197,U+2248,U+2264,U+2713,U+25C7 \
  --layout-features='' \
  --no-hinting \
  --desubroutinize \
  --flavor=woff2 \
  --output-file=JetBrainsMono-400-subset.woff2
```

`Orbitron-500-subset.woff2` uses the same flags against
`Orbitron-Medium.ttf`; that face lacks `^ · → ↗ ≈ ≤ ✓ ◇`, which is why every
site lists `JetBrains Mono Local` behind it in the stack.

| file | source SHA-256 | subset SHA-256 |
| --- | --- | --- |
| `JetBrainsMono-400-subset.woff2` | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` | `da5973f800925cee2223a41f202c1069a9d8bb541015429c51bff0c0dcfa12b2` |
| `Orbitron-500-subset.woff2` | `e1dd2875a4cf1711615b7bc7eb2ae8d05bef3861f87a7fdd847a78199169b458` | `63b8f47a9e5d09b5bf2a277363b264d2617a4e7b04e626a83fd4303c905fa557` |
