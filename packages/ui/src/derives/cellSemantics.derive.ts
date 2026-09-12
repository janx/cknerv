import type {
  CellSemanticRecord,
  ChainAnchor,
  EnrichmentSourceState,
  SemanticAsset,
} from '@cknerv/types';
import { ASSET_STANDARD_ACCENTS, SEGMENT_COLORS } from '../components/hud/cellFormat';
import type { ByteBudgetSegmentKey } from './cellByteBudget.derive';

export const CELL_SEMANTIC_TAU = Math.PI * 2;

/** The orbit decomposes a cell into exactly the four parts the dossier's byte
 *  budget bar does, so it counts them in the same words. It used to spell its
 *  own — `capacity` where the bar says `cap` — and one concept with two
 *  spellings is how the two surfaces ended up with two palettes. */
export type CellSemanticCompositionKind = ByteBudgetSegmentKey;

export interface CellSemanticCompositionSegment {
  kind: CellSemanticCompositionKind;
  bytes: number;
  fraction: number;
  start: number;
  sweep: number;
  color: string;
}

export interface CellSemanticComposition {
  totalBytes: number;
  segments: CellSemanticCompositionSegment[];
}

export type CellSemanticVisualState = 'ready' | 'stale';

/**
 * Turn the source's exact occupied-byte accounting into one closed orbit.
 * An inconsistent breakdown is not visualized: gaps must not be disguised as
 * a presentation fallback.
 *
 * Segment colours come from `SEGMENT_COLORS`, the same table the dossier's
 * byte-budget bar paints with. This file kept a second one for the life of
 * both surfaces — capacity `#ff9d52`, lock `#69e7ff`, type `#78f2b3`, data
 * `#ffd166` — so one cell's bytes were decomposed twice and coloured by two
 * unrelated palettes, and the orbit's capacity arc sat 34.4 from chrome
 * orange, close enough that a Cell's own capacity read as the instrument's
 * frame. Two tables describing one decomposition is not a palette question,
 * it is a duplicate.
 */
export function deriveCellSemanticComposition(
  record: CellSemanticRecord,
): CellSemanticComposition | null {
  const knowledge = record.common_knowledge;
  if (!knowledge || knowledge.total_bytes <= 0) return null;
  const components: Array<readonly [CellSemanticCompositionKind, number]> = [
    ['cap', knowledge.capacity_field_bytes],
    ['lock', knowledge.lock_script_bytes],
    ['type', knowledge.type_script_bytes],
    ['data', knowledge.data_bytes],
  ];
  if (components.some(([, bytes]) => !Number.isSafeInteger(bytes) || bytes < 0)) {
    return null;
  }
  const componentTotal = components.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (componentTotal !== knowledge.total_bytes) return null;

  let cursor = -Math.PI / 2;
  const segments = components.flatMap(([kind, bytes]) => {
    if (bytes === 0) return [];
    const fraction = bytes / knowledge.total_bytes;
    const sweep = fraction * CELL_SEMANTIC_TAU;
    const segment: CellSemanticCompositionSegment = {
      kind,
      bytes,
      fraction,
      start: cursor,
      sweep,
      color: SEGMENT_COLORS[kind],
    };
    cursor += sweep;
    return [segment];
  });
  return { totalBytes: knowledge.total_bytes, segments };
}

/**
 * THE WHOLE OF WHAT THE MARKER READS OFF THE ENRICHMENT SOURCE — three
 * fields, and the type is the discipline that keeps it three.
 *
 * `EnrichmentSourceStatus` is structurally one of these, so every existing
 * caller still passes the record. What it buys is the App: the source record
 * is replaced on EVERY probe round (`last_success_at_ms` is content, and the
 * reducer's deep-equal drops only a literal re-broadcast), so keying the
 * galaxy overlay on the record turned the canopy over once a minute for a
 * marker that could not have looked different. Keyed on this projection, it
 * turns over when the source's answer does.
 */
export interface CellSemanticSourceView {
  source: string;
  status: EnrichmentSourceState;
  validated_anchor?: ChainAnchor;
}

/** Only render records that still sit at or behind the source's validated tip. */
export function cellSemanticVisualState(
  source: CellSemanticSourceView,
  record: CellSemanticRecord,
): CellSemanticVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  return source.status;
}

/** A small protocol-family accent; identity remains the exact type hash. */
export function cellSemanticAssetAccent(asset: SemanticAsset): string {
  const standard = asset.standard?.trim().toLowerCase() ?? '';
  if (standard.includes('xudt')) return ASSET_STANDARD_ACCENTS.xudt;
  if (standard.includes('sudt')) return ASSET_STANDARD_ACCENTS.sudt;
  return ASSET_STANDARD_ACCENTS.other;
}
