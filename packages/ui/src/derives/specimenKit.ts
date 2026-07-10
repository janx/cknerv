// packages/ui/src/derives/specimenKit.ts
import type { AssetKind, CellTag } from '@cknerv/types';

export type Phylum = 'radiolarian' | 'colony' | 'helix' | 'arbor' | 'plasmid';
export type Vec3 = [number, number, number];
export interface NucNode { x: number; y: number; z: number; s: number; a: number }
export interface RawLandmarks { core: Vec3; species: Vec3; membrane: Vec3; outer: Vec3 }
export interface PhylumGeometry { segments: number[]; nodes: NucNode[]; membraneR: number | null; landmarks: RawLandmarks }
export interface PhylumOpts { maturity: number }

export const TAU = 6.28318530718;
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (v: Vec3): Vec3 => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function hashToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.floor(body.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}
export function seededRng(bytes: Uint8Array, salt = 0): () => number {
  let a = ((bytes[0] ?? 1) | ((bytes[1] ?? 2) << 8) | ((bytes[2] ?? 3) << 16) | ((bytes[3] ?? 4) << 24)) >>> 0;
  a = (a ^ (salt * 0x9e3779b1)) >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function randDir(r: () => number): Vec3 {
  const th = r() * TAU, z = r() * 2 - 1, s = Math.sqrt(Math.max(0, 1 - z * z));
  return [s * Math.cos(th), s * Math.sin(th), z];
}
export function randPerp(r: () => number, dir: Vec3): Vec3 {
  let v: Vec3; do { v = randDir(r); } while (Math.abs(v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) > 0.9);
  return norm(cross(v, dir));
}

export function phylumForAsset(a?: AssetKind): Phylum {
  switch (a) {
    case 'native': return 'radiolarian';
    case 'sudt': case 'xudt': return 'colony';
    case 'dao': return 'helix';
    case 'spore': return 'arbor';
    default: return 'plasmid';
  }
}
export function massFromCapacity(shannons: number): number {
  const ckb = Math.max(61, shannons / 1e8);
  return 0.5 + 0.6 * clamp(Math.log10(ckb) / 5.3, 0, 1);
}
const MATURE_MS = 30 * 86400_000;
export function maturityFromAge(bornMs: number, nowMs: number): number {
  return clamp((nowMs - bornMs) / MATURE_MS, 0, 1);
}
export function viabilityFromDeath(deathMs: number | null): number { return deathMs === null ? 1 : 0.4; }
export function dataBytes(hex: string): number {
  const body = (hex.endsWith('…') ? hex.slice(0, -1) : hex).replace(/^0x/, '');
  return Math.floor(body.length / 2);
}
const TAG_TINT: Record<string, Vec3> = {
  wallet: [1.0, 0.71, 0.41], dex: [1.0, 0.59, 0.36], cf: [1.0, 0.56, 0.59], ckbloom: [0.77, 0.86, 0.43],
};
const DEFAULT_TINT: Vec3 = [1.0, 0.70, 0.39];
export function tintFromTag(tag: CellTag | null): Vec3 { return (tag && TAG_TINT[tag]) || DEFAULT_TINT; }

const BASE = ['A', 'C', 'G', 'T'];
export function hashToAcgt(hex: string): string {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  let out = '';
  for (const ch of body) { const v = parseInt(ch, 16); if (Number.isNaN(v)) continue; out += BASE[(v >> 2) & 3] + BASE[v & 3]; }
  return out;
}
