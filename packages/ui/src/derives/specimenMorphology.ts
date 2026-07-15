// packages/ui/src/derives/specimenMorphology.ts
import type { Cell } from '@cknerv/types';
import {
  type Phylum, type Vec3, type NucNode, type PhylumGeometry,
  phylumForAsset, massFromCapacity, maturityFromAge, viabilityFromDeath, dataBytes, tintFromTag,
  seededRng, hashToBytes,
} from './specimenKit';
import { genArbor, genRadiolarian, genColony, genHelix, genPlasmid } from './specimenPhyla';
import { nucleusBoundingRadius, framingScale } from '../components/hud/nucleusFraming';

export interface LandmarkSet { core: Vec3; species: Vec3; membrane: Vec3; organelle: Vec3 | null; body: Vec3; outer: Vec3 }
export interface SpecimenMorphology {
  phylum: Phylum; segments: number[]; nodes: NucNode[]; organelles: NucNode[];
  membraneR: number | null; landmarks: LandmarkSet; mass: number; viability: number; tint: Vec3;
}
export const LANDMARK_FIELDS = ['core', 'species', 'membrane', 'organelle', 'body', 'outer'] as const;
export type LandmarkField = (typeof LANDMARK_FIELDS)[number];

const GEN: Record<Phylum, (h: string, o: { maturity: number }) => PhylumGeometry> = {
  arbor: genArbor, radiolarian: genRadiolarian, colony: genColony, helix: genHelix, plasmid: genPlasmid,
};
const ORG_DIVISOR = 48, MAX_ORG = 8;

export function specimenMorphology(cell: Cell, nowMs: number = Date.now()): SpecimenMorphology {
  const phylum = phylumForAsset(cell.asset_kind);
  const maturity = maturityFromAge(cell.born_at_ms, nowMs);
  const g = GEN[phylum](cell.content_hash, { maturity });

  // framing: normalize positions + node sizes + landmarks to a unit radius
  const radius = nucleusBoundingRadius(g.segments) || 1;
  const k = framingScale(radius, 1.0);
  const seg = g.segments.map((v) => v * k);
  const nodes: NucNode[] = g.nodes.map((n) => ({ x: n.x * k, y: n.y * k, z: n.z * k, s: n.s * k, a: n.a }));
  const sv = (v: Vec3): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

  // Data → discrete memory blocks on a three-plane package grid. The payload
  // stays hash-deterministic, but avoids free-floating organelle placement.
  const r = seededRng(hashToBytes(cell.content_hash), 0x0d1a);
  const nOrg = Math.min(MAX_ORG, Math.round(dataBytes(cell.data_hex) / ORG_DIVISOR));
  const organelles: NucNode[] = [];
  const occupied = new Set<string>();
  for (let i = 0; i < nOrg; i++) {
    let gx = 0, gy = 0, gz = 0, key = '';
    do {
      gx = Math.floor(r() * 5) - 2;
      gy = Math.floor(r() * 3) - 1;
      gz = Math.floor(r() * 5) - 2;
      key = `${gx},${gy},${gz}`;
    } while ((gx === 0 && gy === 0 && gz === 0) || occupied.has(key));
    occupied.add(key);
    organelles.push({
      x: gx * 0.17,
      y: gy * 0.13,
      z: gz * 0.17,
      s: 0.045 + r() * 0.018,
      a: 0.95,
    });
  }

  const landmarks: LandmarkSet = {
    core: sv(g.landmarks.core), species: sv(g.landmarks.species), membrane: sv(g.landmarks.membrane),
    outer: sv(g.landmarks.outer), body: [0, 0, 0],
    organelle: organelles[0] ? [organelles[0].x, organelles[0].y, organelles[0].z] : null,
  };

  return {
    phylum, segments: seg, nodes, organelles,
    membraneR: g.membraneR === null ? null : g.membraneR * k,
    landmarks, mass: massFromCapacity(cell.capacity), viability: viabilityFromDeath(cell.death_at_ms), tint: tintFromTag(cell.tag),
  };
}
