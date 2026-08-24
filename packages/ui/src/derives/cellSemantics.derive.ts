import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticAsset,
} from '@cknerv/types';
import { SEGMENT_COLORS } from '../components/hud/cellFormat';
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

/** Only render records that still sit at or behind the source's validated tip. */
export function cellSemanticVisualState(
  source: EnrichmentSourceStatus,
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
  if (standard.includes('xudt')) return '#c8ff72';
  if (standard.includes('sudt')) return '#72ffd4';
  return '#d8b4ff';
}
