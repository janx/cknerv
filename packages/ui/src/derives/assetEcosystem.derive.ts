import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  anchoredRecordVisualState,
  type AnchoredRecordVisualState,
} from './anchoredRecord.derive';

export type AssetEcosystemVisualState = AnchoredRecordVisualState;

export const ASSET_ECOSYSTEM_STALE_AFTER_MS = 90_000;

// The record's `capacity_breakdown` still arrives on the wire, validated by the
// adapter, and nothing on the HUD draws it any more. CELL CENSUS splits the
// chain by the index's family counts (`scriptFamilies.derive.ts`, the same
// two bars STAGE·07 draws), because the capacity split — DAO 14%, TOKENS
// 0.08%, OBJECTS 0.03%, OTHER 85% — sat under a Cell count and read as a Cell
// mix, which it is not: a token Cell holds close to the least a Cell can
// hold, a balance Cell some three hundred times that, and the shares said
// only which Cells hold the CKB.

/** Only expose a sample while its source still has a compatible anchor. */
export function assetEcosystemVisualState(
  source: EnrichmentSourceStatus,
  record: AssetEcosystemRecord,
  nowMs = Date.now(),
): AssetEcosystemVisualState | null {
  return anchoredRecordVisualState(source, record, ASSET_ECOSYSTEM_STALE_AFTER_MS, nowMs);
}
