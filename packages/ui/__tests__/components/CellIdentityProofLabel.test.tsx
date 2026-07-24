import { describe, expect, it } from 'vitest';
import {
  presentCellIdentityProofLabel,
} from '../../src/components/cellIdentityProofLabel.presentation';

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
});
