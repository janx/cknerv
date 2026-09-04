import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearPeerNodeHover,
  markPeerNodeHover,
  peerNodeHoverId,
  peerNodeHovered,
} from '../../src/components/peerHoverWord';
import { stagedPickTargets } from '../../src/components/ColonyNodes';
import type { NetworkNode } from '../../src/types';

const node = (id: string, over: Partial<NetworkNode> = {}): NetworkNode => ({
  id,
  kind: 'sighted',
  pos: [0, 20, 0],
  ...over,
} as NetworkNode);

describe('the scene’s hover word carries a tier', () => {
  let canvas: HTMLElement;
  beforeEach(() => {
    canvas = document.createElement('canvas');
  });

  it('writes the id and the tier together', () => {
    markPeerNodeHover(canvas, 'QmPeer', 'measured');

    expect(canvas.dataset.peerNodeHover).toBe('QmPeer');
    expect(canvas.dataset.peerNodeTier).toBe('measured');
    expect(peerNodeHovered(canvas)).toBe(true);
    expect(peerNodeHoverId(canvas)).toBe('QmPeer');
  });

  it('retracts them together, and only when the word is ours', () => {
    markPeerNodeHover(canvas, 'QmPeer', 'measured');

    // r3f cancels the stale instance AFTER the next one has claimed the word;
    // retracting somebody else's would strand the cursor on a live target.
    expect(clearPeerNodeHover(canvas, 'QmSomebodyElse')).toBe(false);
    expect(canvas.dataset.peerNodeHover).toBe('QmPeer');
    expect(canvas.dataset.peerNodeTier).toBe('measured');

    expect(clearPeerNodeHover(canvas, 'QmPeer')).toBe(true);
    expect(canvas.dataset.peerNodeHover).toBeUndefined();
    expect(canvas.dataset.peerNodeTier).toBeUndefined();
    expect(peerNodeHovered(canvas)).toBe(false);
    // Nothing to retract twice.
    expect(clearPeerNodeHover(canvas, 'QmPeer')).toBe(false);
  });

  it('answers a raster with the tier a mark belongs to', () => {
    // The reading the 2026-09-04 census could not take: a measured peer's id
    // and a sighted node's id are both `Qm…`, so "are all twelve of our peers
    // hoverable?" was undecidable from the hover oracle alone. The words are
    // the ones a VIEWER can name — the four cards — rather than the graph's
    // own `NodeKind`, whose producer rung is spelled `attested`.
    for (const tier of ['measured', 'sighted', 'cohort', 'local'] as const) {
      markPeerNodeHover(canvas, `id:${tier}`, tier);
      expect(canvas.dataset.peerNodeTier).toBe(tier);
    }
  });
});

describe('every staged target names its own tier', () => {
  it('sighted marks say sighted and cohort marks say cohort', () => {
    const targets = stagedPickTargets(
      [node('QmSighted')],
      [node('attested:0xabc', { kind: 'attested' })],
    );

    expect(targets.map((t) => t.tier)).toEqual(['sighted', 'cohort']);
  });
});

/**
 * The fence. Three layers publish this word and one module owns it; a fourth
 * writer, or a third hand writing the id without the tier, is the failure the
 * tier exists to prevent — a raster that reads `measured` for a mark nobody
 * measured is worse than a raster that reads nothing.
 */
describe('one owner for the hover word', () => {
  const SRC = resolve(process.cwd(), 'src');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  it('is the only module that touches either dataset property', () => {
    const owner = resolve(SRC, 'components/peerHoverWord.ts');
    const offenders = walk(SRC)
      .filter((file) => file !== owner)
      .filter((file) => /dataset\.peerNode(Hover|Tier)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
