import type { ScriptFamilyBucket } from '../../derives/scriptFamilies.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { SCOPE_TAG, SUBHEAD } from './primitives';

/** Mainnet is 99% one lock family, so every other family rounds to zero and a
 *  bar naming 120 real cells would read "JoyID 0%" — present in the legend and
 *  claiming to be absent. A bucket that exists says so. */
function share(count: number, total: number): string {
  const pct = (count / total) * 100;
  return pct < 0.5 ? '<1%' : `${Math.round(pct)}%`;
}

/** One bar over a population's script families, legend naming only what a
 *  reader can see. A 99%-one-family bar turns a legend of every sub-percent
 *  name into a list of things the bar does not show; those collapse into one
 *  honest tail count, with the full breakdown on the bar's tooltip.
 *
 *  `scope` is the population, wherever the bar is not the panel's own: this
 *  bar has been fed by two different ones, and the whole failure it was
 *  built to end is a distribution over the retained window drawn under a
 *  panel that says STAGE. Under CELL CENSUS the population IS the panel's —
 *  the chain — and a tag saying so was noise; the slot there carries only
 *  the one word a reader must not miss, STALE, and nothing otherwise. */
export default function TaxonomyBar({ title, scope, buckets }: {
  title: string;
  scope?: string;
  buckets: ScriptFamilyBucket[];
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total <= 0) return null;
  const nonZero = buckets.filter((bucket) => bucket.count > 0);
  let named = nonZero.filter((bucket) => (bucket.count / total) * 100 >= 0.5);
  if (named.length === 0) {
    named = [[...nonZero].sort((a, b) => b.count - a.count)[0]];
  }
  const tail = nonZero.filter((bucket) => !named.includes(bucket));
  const tailFamilies = tail.reduce((sum, bucket) => sum + bucket.families, 0);
  const full = nonZero
    .map((bucket) => `${bucket.label} ${share(bucket.count, total)}`)
    .join(' · ');
  return (
    <div data-taxonomy-bar={title} style={{ marginTop: 7 }} title={full}>
      {/* Qualifier right after the label, never a third column — same rule
          the funnel rows follow, and for the same reason. */}
      <div style={{ ...SUBHEAD, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span>{title}</span>
        {scope ? <span data-taxonomy-scope={title} style={SCOPE_TAG}>{scope}</span> : null}
      </div>
      <div style={{ display: 'flex', height: 6, border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.14)}`, background: HUD_COLORS.trackGround }}>
        {nonZero.map((bucket) => (
          <span
            key={bucket.key}
            data-taxonomy-segment={bucket.key}
            style={{ width: `${(bucket.count / total) * 100}%`, minWidth: 1, background: bucket.color }}
          />
        ))}
      </div>
      {/* Qualitative: one hue per script family, so the name carries the hue.
          The tail count stays `dim` — it names no segment. */}
      <div
        data-taxonomy-legend="qualitative"
        style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {named.map((bucket, index) => (
          <span key={bucket.key}>
            {index > 0 ? ' · ' : null}
            <span data-taxonomy-legend-name style={{ color: bucket.color }}>{bucket.label}</span>
            {` ${share(bucket.count, total)}`}
          </span>
        ))}
        {tailFamilies > 0 ? (
          <span style={{ color: HUD_COLORS.dim }}>{` · +${tailFamilies} <1%`}</span>
        ) : null}
      </div>
    </div>
  );
}
