import { describe, expect, it } from 'vitest';
import type {
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
} from '@cknerv/types';
import {
  deriveNetworkAtlasVisual,
  NETWORK_ATLAS_STALE_AFTER_MS,
  networkAtlasVisualState,
} from '../../src/derives/networkAtlas.derive';
import { CONTENT_BANDS } from '../../src/components/hud/cellFormat';
import { QUALITATIVE_BUCKET_COLORS } from '../../src/components/hud/hudTheme';

const record: NetworkAtlasRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  updated_at_ms: 1,
  crawl_round: 7,
  crawl_finished_at_s: 1_700_000_000,
  total_known: 42,
  last_round_attempted: 12,
  last_round_reachable: 9,
  new_nodes: 3,
  sample_size: 3,
  sample_reachable: 2,
  sample_truncated: true,
  median_rtt_ms: 18,
  countries: [
    { label: 'US', count: 1 },
    { label: 'SG', count: 2 },
  ],
  versions: [
    { label: '0.118.0', count: 1 },
    { label: '0.119.0', count: 2 },
  ],
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['network_atlas'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('network atlas visual derivation', () => {
  it('sorts the exact sample buckets without exposing individual peers', () => {
    const visual = deriveNetworkAtlasVisual(record);
    expect(visual?.countries.map(({ label, count }) => ({ label, count }))).toEqual([
      { label: 'SG', count: 2 },
      { label: 'US', count: 1 },
    ]);
    expect(visual?.versions[0].label).toBe('0.119.0');
    expect(record).not.toHaveProperty('peers');
  });

  it('rejects samples that exceed the bound or disagree with their buckets', () => {
    expect(deriveNetworkAtlasVisual({ ...record, sample_size: 65 })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      countries: [{ label: 'SG', count: 2 }],
    })).toBeNull();
    expect(deriveNetworkAtlasVisual({
      ...record,
      sample_reachable: 4,
    })).toBeNull();
  });

  it('colours both bars out of one ramp that means nothing', () => {
    // Two claims at once. Every bucket takes a slot of the shared ramp — the
    // countries and the versions used to hold two arrays that agreed on three
    // of their five values anyway, and the ramp is the house's now, handed out
    // by rank on the STAGE script bar for the same reason it is handed out by
    // hash here — and none of them lands on a content band, because a country
    // is not an asset class and a bar that said it was would be lying in a way
    // a reader cannot see.
    const visual = deriveNetworkAtlasVisual(record);
    const painted = [...visual?.countries ?? [], ...visual?.versions ?? []]
      .map((bucket) => bucket.color);
    expect(painted).toHaveLength(4);
    expect(painted.every((color) => QUALITATIVE_BUCKET_COLORS.includes(color))).toBe(true);
    const bands = new Set<string>(Object.values(CONTENT_BANDS));
    expect(QUALITATIVE_BUCKET_COLORS.filter((color) => bands.has(color))).toEqual([]);
  });

  it('requires the capability, usable source, and compatible anchor', () => {
    expect(networkAtlasVisualState(source, record, 1)).toBe('ready');
    expect(networkAtlasVisualState({ ...source, capabilities: [] }, record, 1))
      .toBeNull();
    expect(networkAtlasVisualState({ ...source, status: 'error' }, record, 1))
      .toBeNull();
    expect(networkAtlasVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, 1)).toBeNull();
  });

  it('dims the atlas when its minute refresh stops', () => {
    expect(networkAtlasVisualState(
      source,
      record,
      record.updated_at_ms + NETWORK_ATLAS_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
