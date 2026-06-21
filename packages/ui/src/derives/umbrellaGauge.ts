export interface UmbrellaGeometry { paths: string[]; litCount: number; total: number; }

export function umbrellaWedges(aliveRatio: number, count = 8, cx = 50, cy = 50, r = 46): UmbrellaGeometry {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(aliveRatio) ? aliveRatio : 0));
  const litCount = Math.round(ratio * count);
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / count) * 2 * Math.PI - Math.PI / 2;
    const am = (a0 + a1) / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const cxm = cx + r * 1.12 * Math.cos(am), cym = cy + r * 1.12 * Math.sin(am);
    paths.push(`M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} Q${cxm.toFixed(2)},${cym.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)} Z`);
  }
  return { paths, litCount, total: count };
}
