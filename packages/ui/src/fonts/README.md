# HUD font subsets

These files are not under the repository's GPL-3.0 license. Six are SIL
Open Font License 1.1 and one is public domain; the per-file copyright
notices and the full license text live in
[`THIRD_PARTY_LICENSES.md`](../../../../THIRD_PARTY_LICENSES.md).

`HuiwenMincho-subset.woff2` is a 32-glyph subset of 汇文明朝体
(`Huiwen-mincho`) for the Chinese text used by the HUD:

```text
共识基元胞汤脉搏节点场字对端状态警告道样本细记录交易输入谱系见证
```

That list is exactly the glyphs rendered in `HUD_FONTS.cjk` today — the `cjk`
props of `PanelHeader` (including `StageCapacityPanel`'s 样本 and `CellsPanel`'s
元胞汤), `WarningBar`'s 警告, `StatusStrip`'s 状态, the inspector cards' title
companions (`PeerLinkCard`'s 对端, `NodeSelfCard`'s 节点, `CellDetailPanel`'s
细胞), the CKByte's own name 字节元 over the two surfaces whose subject is that
unit — `CellByteBudget`'s `CKBYTE 字节元`, the zone that counts CKBytes, and
`CellDataReader`'s `CKBYTES 字节元`, the reader that shows their bytes — and
the three consensus-memory endpoint markers drawn over the stage by
`nerve/ConsensusMemoryMarkers`: 共识记录, 交易输入, 谱系见证.
(`SightedNodeCard` documents in-file why it deliberately wears none.)

The reader is the one addition that cost this list nothing: it wears the same
three glyphs the budget already brought, so the set below, its count of 32 and
the subset SHA are all unchanged by it. Say a NEW glyph and the whole recipe at
the bottom of this section has to run again.

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

It is a SET, and the count is the whole point: it stayed at 32 across the
CELL·03 pass only because that pass gave two glyphs back. 字 and 汤 arrived
with 字节元 and `CellsPanel`'s 元胞汤; 神 and 经 left with the 神经元 that label
replaced, and they are GONE rather than merely unused — the panel counted cell
bodies while its companion named a neuron, which is the dendrite fabric between
them. A glyph no surface renders any more comes out, so this list can be read
as the truth about the HUD rather than as a high-water mark.

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
  --text='共识基元胞汤脉搏节点场字对端状态警告道样本细记录交易输入谱系见证' \
  --no-ignore-missing-unicodes \
  --flavor=woff2 \
  --output-file=HuiwenMincho-subset.woff2
```

The expected SHA-256 for the checked-in subset is
`e27ad36f1d4cd1d9949f7da2f481c67af7c8e6d77b736b2070c73b81f63f991a`.

## `JetBrains Mono Local` / `Orbitron Local`

`JetBrainsMono-400-subset.woff2` and `Orbitron-500-subset.woff2` back the two
families the in-scene labels name directly (`CellGalaxy`,
`ConsensusMemoryMarkers`, `ConsensusRouteHopMarker`, `hud/ConsensusMemory`).
Both upstream faces are SIL OFL 1.1. They replace the full 274KB/18KB TTFs that
used to ride into the bundle unregistered — the families resolved to
`ui-monospace` on any machine without the face installed locally.

Coverage is ASCII printable plus every symbol the HUD renders anywhere:

```text
· × – — • ← → ↓ ↗ ≈ ≤ ≥ ◆ ◇ ✓
```

That list grew past what the in-scene labels alone need, and deliberately.
`JetBrains Mono Local` is now also the SYMBOL FALLBACK behind all three of the
HUD's Latin voices (see `HUD_FONTS` in `components/hud/hudTheme.ts`): the three
Latin faces below are Google's pre-built `latin`-range woff2 and that range
stops before the Arrows and Geometric Shapes blocks, so `← → ↓ ◆ ◇` had no
carrier in the DOM overlay at all and were resolving out of whatever the
reader's machine had installed. `≥` rides along with `≤` out of the source
face rather than being asked for; it is in the cmap, so it is in the list.

Optional layout features are dropped on purpose: JetBrains Mono's programming
ligatures would otherwise fire inside a hex cell id. Orbitron ships Medium only
while the galaxy label asks for both 400 and 500, so its `@font-face` claims the
whole `400 500` span instead of letting the browser synthesize a bold.

Regenerate with FontTools 4.63 or later:

```bash
pyftsubset /path/to/JetBrainsMono-Regular.ttf \
  --unicodes=U+0020-007E,U+00B7,U+00D7,U+2013,U+2014,U+2022,U+2190,U+2192,U+2193,U+2197,U+2248,U+2264,U+2713,U+25C6,U+25C7 \
  --layout-features='' \
  --no-hinting \
  --desubroutinize \
  --flavor=woff2 \
  --output-file=JetBrainsMono-400-subset.woff2
```

`Orbitron-500-subset.woff2` uses the same flags against
`Orbitron-Medium.ttf`. That face carries four of the symbols above and no
more — `× – — •` — which is why every site lists `JetBrains Mono Local` behind
it in the stack. That arrangement is the precedent the DOM voices now follow.

| file | source SHA-256 | subset SHA-256 |
| --- | --- | --- |
| `JetBrainsMono-400-subset.woff2` | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` | `21c064fc340ecb50f48702cd3661431297740303722785f7ee2fe0586c2bc3fb` |
| `Orbitron-500-subset.woff2` | `e1dd2875a4cf1711615b7bc7eb2ae8d05bef3861f87a7fdd847a78199169b458` | `63b8f47a9e5d09b5bf2a277363b264d2617a4e7b04e626a83fd4303c905fa557` |

## The Latin faces

`Saira-latin.woff2`, `ChakraPetch-500-latin.woff2`, `ChakraPetch-700-latin.woff2`
and `ShareTechMono-latin.woff2` are Google Fonts' own pre-built `latin`-range
woff2 shards, dropped in as downloaded. All four are SIL OFL 1.1. Nothing here
cuts them, which is the important part: their coverage is not a decision this
repo made and cannot be widened by re-running a command.

`latin` is a published, fixed unicode-range, and what matters about it is where
it STOPS. It reaches Latin-1, a handful of Latin Extended, the General
Punctuation block (`– — ‹ › … ′ ″`), `⁴ € ™`, and above `™` exactly four
characters: `↑ ↓ − ∕`. It does not reach `→`. It does
not reach the Geometric Shapes block at all — `◆ ◇ ● ▲ ▼ ▦` are outside it, and
so is `↔`.

For most of the HUD's life that made every geometric mark and every arrow in
the overlay a silent fallback to whatever face the reader's machine offered —
the same failure this file documents for the Chinese subset, arriving from the
side nobody checked, because a Latin face reads as "obviously has letters" and
the question stops there. Two things fixed it and both are load-bearing:
`JetBrains Mono Local` now sits behind all three as a symbol fallback, and the
marks that no face carries are drawn as CSS/SVG in `components/hud/primitives.tsx`
instead of typed.

Upstream is no help here either, so re-cutting our own subsets would not have
been the fix: `Share Tech Mono` has no arrow glyphs at all, `Saira` has the
arrows but no filled shapes, `Chakra Petch` has `◆ ▲ ▼` but no `● ↔ ▦`, and no
face any of them descends from has `▦` or `∅`.

The checked-in bytes, pinned so the coverage table in
`__tests__/components/hud/hudDiscipline.test.ts` cannot drift from them:

| file | SHA-256 |
| --- | --- |
| `Saira-latin.woff2` | `7eb811eb14b2ee22e3fba942b25c6cd062ff050bde10d29af1a4e16f99712e17` |
| `ChakraPetch-500-latin.woff2` | `36ad966cb653de70ba37355c41003b02de8940b2df6cbcd46480a6ad8cadd65d` |
| `ChakraPetch-700-latin.woff2` | `ce5095dc1cb200aaa939e38067a0677018d10e9f26ec38cdcf1557ac524fc775` |
| `ShareTechMono-latin.woff2` | `41e6b9f297f7d9a2df2aaa274092f76d2f72711a15ca455f7f4f4f92caf16b72` |
