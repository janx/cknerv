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
