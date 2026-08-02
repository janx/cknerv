import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

function materialSource(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/materials/${file}`), 'utf8');
}

describe('NetworkColony Cell-inspection context', () => {
  it('eases one shared passive-context value for edges and nodes', () => {
    const network = source('NetworkColony.tsx');

    expect(network).toContain('cellInspectionActive?: boolean');
    expect(network).toContain('cellDetailViewFocusRef?:');
    expect(network).toContain('cellDetailPeerContextEnergy(');
    expect(network).toContain('useFrame((_, deltaSeconds) =>');
    expect(network).toContain('dampCellInspectionFieldScale(');
    expect(network).toContain('CELL_INSPECTION_BACKGROUND_ENERGY');
    expect(network).toContain('Math.min(detailContext, inspectionContext)');
    expect(network.match(/contextEnergyRef=\{contextEnergyRef\}/g))
      .toHaveLength(2);
  });

  it('subdues ambient P2P fibres but preserves real block surges', () => {
    const edges = source('ColonyEdges.tsx');

    expect(edges).toContain('uniform float uContextEnergy');
    expect(edges).toContain('float passiveShape = base + ambient');
    expect(edges).toContain(
      'float passive = passiveShape * uContextEnergy',
    );
    expect(edges).toContain('float intensity = passiveShape + surge');
    expect(edges).toContain(
      'vec3 col = uColor * passive + uSurgeColor * surge',
    );
    expect(edges).not.toContain('float intensity = passive + surge');
    expect(edges).not.toContain('surge * uContextEnergy');
  });

  it('keeps a separately selected peer legible inside Cell inspection', () => {
    const nodes = source('ColonyNodes.tsx');
    const material = materialSource('peerNodeMaterial.ts');

    expect(material).toContain('uDim * uContextEnergy');
    expect(material).toContain('float passiveShape = shape * eventScale');
    expect(material).toContain(
      'return vec4(color, passiveShape + eventAlpha)',
    );
    expect(material).not.toContain(
      'return vec4(color, passive + eventAlpha)',
    );
    expect(material).toContain('shape * alphaExtra * eventScale');
    expect(nodes).toContain(
      'selected ? 1 : contextEnergyRef?.current ?? 1',
    );
    expect(nodes).toContain('contextEnergyRef={contextEnergyRef}');
  });

  it('keeps peer-only inspection from inheriting the Cell close-view fade', () => {
    const network = source('NetworkColony.tsx');

    expect(network).toContain(
      'selectedId === null || cellInspectionActive',
    );
  });
});
