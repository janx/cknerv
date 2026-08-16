# HUD font subsets

`HuiwenMincho-subset.woff2` is a 22-glyph subset of 汇文明朝体
(`Huiwen-mincho`) for the Chinese text used by the HUD:

```text
共识记忆细胞状态脉搏警告节点对端播种网络全道
```

The source font comes from the Chinese Webfont Project package
[`@chinese-fonts/hwmct`](https://github.com/KonghaYao/chinese-free-web-font-storage/tree/branch/packages/hwmct).
Its embedded copyright record is `Public Domain`.

Source file SHA-256:
`1ea5d0450c0d034c3e4077f2b533d74fbd1bf1f14d938477389338e64d3d8d9c`.

Regenerate with FontTools 4.63 or later:

```bash
pyftsubset /path/to/汇文明朝体.ttf \
  --text='共识记忆细胞状态脉搏警告节点对端播种网络全道' \
  --no-ignore-missing-unicodes \
  --flavor=woff2 \
  --output-file=HuiwenMincho-subset.woff2
```

The expected SHA-256 for the checked-in subset is
`f9429f53caafbc37a03c01d136ba4a8d5fa45d209ee70ef49a99d6800e74c883`.

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
