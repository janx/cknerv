import { describe, expect, it } from 'vitest';
import {
  presentCellIdentityProofLabel,
  type CellIdentityProofLabelPresentation,
} from '../../src/components/cellIdentityProofLabel.presentation';
import {
  makeFrameDatasetLedger,
} from '../../src/nerve/frameDatasetLedger';

/**
 * A label element that records every write instead of only its final state.
 * The echo holds one placement for most of its life, so "what reached the
 * DOM" is the measurement, and only a stubbed node can answer it.
 */
function recordingLabelNode(color?: string): {
  node: HTMLDivElement;
  writes: string[];
} {
  const writes: string[] = [];
  const style = {
    setProperty(property: string, value: string) {
      writes.push(`style ${property}=${value}`);
    },
  } as unknown as CSSStyleDeclaration;
  const seed: Record<string, string> = {};
  if (color) seed.memoryIdentityProofLabelColor = color;
  const dataset = new Proxy(seed, {
    set(store, key, value: string) {
      writes.push(`data ${String(key)}=${value}`);
      store[key as string] = value;
      return true;
    },
  }) as unknown as DOMStringMap;
  return {
    node: { style, dataset } as unknown as HTMLDivElement,
    writes,
  };
}

const CONFIRMING: CellIdentityProofLabelPresentation = {
  state: 'confirming',
  progress: 0.5,
  strength: 0.8,
  reducedMotion: false,
  screenX: 900,
  screenY: 400,
  viewportWidth: 1200,
  viewportHeight: 800,
  radiusPx: 40,
};

describe('CellIdentityProofLabel presentation', () => {
  it('places a visible label left of a proof in the inspection half', () => {
    const node = document.createElement('div');
    node.dataset.memoryIdentityProofLabelColor = '#9DF7FF';

    presentCellIdentityProofLabel(node, {
      state: 'confirming',
      progress: 0.5,
      strength: 0.8,
      reducedMotion: false,
      screenX: 900,
      screenY: 400,
      viewportWidth: 1200,
      viewportHeight: 800,
      radiusPx: 40,
    });

    expect(node.dataset).toMatchObject({
      memoryIdentityProofLabelState: 'confirming',
      memoryIdentityProofLabelSide: 'left',
      memoryIdentityProofLabelVertical: 'above',
      memoryIdentityProofLabelOpacity: '0.752',
    });
    expect(node.style.opacity).toBe('0.752');
    expect(node.style.transform).toContain('calc(-100% - 48.00px)');
    expect(node.style.transformOrigin).toBe('right center');
    expect(node.style.borderRightColor).toBe('rgb(157, 247, 255)');
    expect(node.style.borderLeftColor).toBe('transparent');
  });

  it('removes the label with the canonical marker strength', () => {
    const node = document.createElement('div');

    presentCellIdentityProofLabel(node, {
      state: 'settled',
      progress: 1,
      strength: 0,
      reducedMotion: false,
      screenX: 100,
      screenY: 20,
      viewportWidth: 1200,
      viewportHeight: 800,
      radiusPx: 0,
    });

    expect(node.dataset).toMatchObject({
      memoryIdentityProofLabelState: 'settled',
      memoryIdentityProofLabelSide: 'right',
      memoryIdentityProofLabelVertical: 'below',
      memoryIdentityProofLabelOpacity: '0.000',
    });
    expect(node.style.opacity).toBe('0');
    expect(node.style.transformOrigin).toBe('left center');
  });

  it('repeats a frame without touching the element a second time', () => {
    const ledger = makeFrameDatasetLedger();
    const { node, writes } = recordingLabelNode('#9DF7FF');

    presentCellIdentityProofLabel(node, CONFIRMING, ledger);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes).toContain('style opacity=0.752');
    expect(writes).toContain('data memoryIdentityProofLabelState=confirming');

    // Same frame, same everything: the element already says all of it.
    writes.length = 0;
    presentCellIdentityProofLabel(node, CONFIRMING, ledger);
    expect(writes).toEqual([]);

    // A label that remounted is a different element carrying the markup's
    // own initial attributes, so its ledger owes it the whole frame again.
    const remounted = recordingLabelNode('#9DF7FF');
    presentCellIdentityProofLabel(remounted.node, CONFIRMING, ledger);
    expect(remounted.writes).toContain('style opacity=0.752');
    expect(remounted.writes).toContain(
      'data memoryIdentityProofLabelState=confirming',
    );
  });

  it('lands a real change in the very call that carries it', () => {
    const ledger = makeFrameDatasetLedger();
    const { node, writes } = recordingLabelNode('#9DF7FF');
    presentCellIdentityProofLabel(node, CONFIRMING, ledger);

    // The echo dimmed: the opacity pair moves and nothing else does.
    writes.length = 0;
    presentCellIdentityProofLabel(
      node,
      { ...CONFIRMING, strength: 0.4 },
      ledger,
    );
    expect(writes).toEqual([
      'style opacity=0.376',
      'data memoryIdentityProofLabelOpacity=0.376',
    ]);

    // The proof crossed into the inspection half: the tag flips sides, and
    // the transform, the lit edge and the published side all follow it in
    // the same call.
    writes.length = 0;
    presentCellIdentityProofLabel(
      node,
      { ...CONFIRMING, strength: 0.4, screenX: 100 },
      ledger,
    );
    expect(writes).toEqual([
      'style transform=translate3d(48.00px, calc(-100% + -8.00px), 0)',
      'style transform-origin=left center',
      'style border-left-color=#9DF7FF',
      'style border-right-color=transparent',
      'data memoryIdentityProofLabelSide=right',
    ]);
  });

  it('leaves the element saying exactly what an unledgered run would', () => {
    const plain = document.createElement('div');
    const ledgered = document.createElement('div');
    plain.dataset.memoryIdentityProofLabelColor = '#9DF7FF';
    ledgered.dataset.memoryIdentityProofLabelColor = '#9DF7FF';
    const ledger = makeFrameDatasetLedger();
    const echo: CellIdentityProofLabelPresentation[] = [
      { ...CONFIRMING, strength: 0.2, screenX: 100 },
      { ...CONFIRMING, strength: 0.55, radiusPx: 52 },
      { ...CONFIRMING, strength: 0.9, screenY: 20 },
      { ...CONFIRMING, strength: 0.9, screenY: 20 },
      { ...CONFIRMING, state: 'settled', progress: 1, strength: 0 },
      { ...CONFIRMING, state: 'settled', progress: 1, strength: 0 },
    ];

    for (const presentation of echo) {
      presentCellIdentityProofLabel(plain, presentation);
      presentCellIdentityProofLabel(ledgered, presentation, ledger);
    }

    expect(ledgered.style.opacity).toBe(plain.style.opacity);
    expect(ledgered.style.transform).toBe(plain.style.transform);
    expect(ledgered.style.transformOrigin).toBe(plain.style.transformOrigin);
    expect(ledgered.style.borderLeftColor).toBe(plain.style.borderLeftColor);
    expect(ledgered.style.borderRightColor).toBe(plain.style.borderRightColor);
    expect({ ...ledgered.dataset }).toEqual({ ...plain.dataset });
  });
});
