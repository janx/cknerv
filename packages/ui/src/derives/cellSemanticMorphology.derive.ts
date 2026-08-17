import type {
  Cell,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticScript,
  ShapeSeed,
} from '@cknerv/types';
import { cellSemanticVisualState } from './cellSemantics.derive';

export type CellSemanticMorphologyStatus =
  | 'absent'
  | 'inactive'
  | 'valid'
  | 'mismatch';

export interface CellSemanticRecordValidation {
  status: CellSemanticMorphologyStatus;
  record: CellSemanticRecord | null;
  message: string | null;
}

export interface CellSemanticScriptLabel {
  role: 'lock' | 'type';
  text: string;
  parameter: number;
}

export interface CellSemanticDataSegment {
  label: string;
  meaning: string;
  value: string;
  startByte: number;
  endByte: number;
  start: number;
  end: number;
  colorIndex: number;
}

export interface CellSemanticKnowledgeSegment {
  role: 'capacity' | 'lock' | 'type' | 'data';
  bytes: number;
  start: number;
  end: number;
}

export interface CellSemanticRoleGlyph {
  role: 'dao' | 'dep_group' | 'code_cell';
  label: string;
  parameter: number;
}

/** Selected-portrait explanation only. It never participates in Cell
 * morphology derivation or in the galaxy near-LOD cache. */
export interface CellSemanticMorphologyOverlay {
  source: string;
  scriptLabels: readonly CellSemanticScriptLabel[];
  dataSegments: readonly CellSemanticDataSegment[];
  knowledgeSegments: readonly CellSemanticKnowledgeSegment[];
  roleGlyphs: readonly CellSemanticRoleGlyph[];
  fingerprint: string;
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameSeed(left: ShapeSeed, right: ShapeSeed): boolean {
  return (left[0] >>> 0) === (right[0] >>> 0)
    && (left[1] >>> 0) === (right[1] >>> 0);
}

/** CKB script_hash is blake2b-256(packed Script), the same digest used by the
 * adapter's canonical component seed. V2 pins the first eight bytes as two
 * big-endian u32 words. */
export function semanticScriptShapeSeed(scriptHash: string): ShapeSeed | null {
  if (!/^0x[0-9a-f]{64}$/i.test(scriptHash)) return null;
  return [
    Number.parseInt(scriptHash.slice(2, 10), 16) >>> 0,
    Number.parseInt(scriptHash.slice(10, 18), 16) >>> 0,
  ];
}

function scriptSeedMismatch(
  role: 'lock' | 'type',
  script: SemanticScript,
  expected: ShapeSeed,
): string | null {
  const actual = semanticScriptShapeSeed(script.script_hash);
  if (actual === null) return `${role} script identity hash is invalid`;
  return sameSeed(actual, expected)
    ? null
    : `${role} script identity does not match the canonical Cell shape seed`;
}

export function cellSemanticRecordMorphologyMismatch(
  cell: Cell,
  record: CellSemanticRecord,
): string | null {
  if (
    !sameHash(record.out_point.tx_hash, cell.out_point.tx_hash)
    || record.out_point.index !== cell.out_point.index
  ) return 'semantic record outpoint does not match the selected Cell';

  if (record.lock_script) {
    const mismatch = scriptSeedMismatch(
      'lock',
      record.lock_script,
      cell.lock_shape_seed,
    );
    if (mismatch) return mismatch;
  }
  if (record.type_script && cell.type_shape_seed === null) {
    return 'semantic record has a type script but the canonical Cell does not';
  }
  if (record.type_script && cell.type_shape_seed !== null) {
    const mismatch = scriptSeedMismatch(
      'type',
      record.type_script,
      cell.type_shape_seed,
    );
    if (mismatch) return mismatch;
  }

  if (record.content && record.content.total_bytes !== cell.data_bytes) {
    return 'semantic Cell-data length does not match the canonical Cell';
  }
  if (
    record.common_knowledge
    && record.common_knowledge.data_bytes !== cell.data_bytes
  ) return 'semantic occupied DATA bytes do not match the canonical Cell';

  const knowledge = record.common_knowledge;
  if (knowledge) {
    const total = knowledge.capacity_field_bytes
      + knowledge.lock_script_bytes
      + knowledge.type_script_bytes
      + knowledge.data_bytes;
    if (total !== knowledge.total_bytes) {
      return 'semantic occupied-byte breakdown is internally inconsistent';
    }
  }

  const deterministic = record.content?.deterministic;
  if (deterministic) {
    for (const segment of deterministic.segments) {
      if (
        !Number.isSafeInteger(segment.start_byte)
        || !Number.isSafeInteger(segment.end_byte)
        || segment.start_byte < 0
        || segment.start_byte > segment.end_byte
        || segment.end_byte > cell.data_bytes
      ) return 'semantic Cell-data segment is outside the canonical byte range';
    }
  }
  return null;
}

/** Apply source/anchor lifecycle gates before a record can reach the portrait.
 * A stale or removed source simply withdraws the overlay; a canonical mismatch
 * is promoted through the inspector's existing semantic error presentation. */
export function validateCellSemanticRecordForMorphology({
  cell,
  record,
  source,
  phase,
}: {
  cell: Cell;
  record: CellSemanticRecord | null | undefined;
  source: EnrichmentSourceStatus | null | undefined;
  phase: string | null | undefined;
}): CellSemanticRecordValidation {
  if (!record) return { status: 'absent', record: null, message: null };
  if (phase !== 'ready' || !source || source.status !== 'ready') {
    return { status: 'inactive', record: null, message: null };
  }
  if (!source.validated_anchor) {
    return { status: 'inactive', record: null, message: null };
  }
  if (cellSemanticVisualState(source, record) !== 'ready') {
    return {
      status: 'inactive',
      record: null,
      message: 'semantic portrait evidence is not anchored to the active source proof',
    };
  }
  const mismatch = cellSemanticRecordMorphologyMismatch(cell, record);
  if (mismatch) return { status: 'mismatch', record: null, message: mismatch };
  return { status: 'valid', record, message: null };
}

function labelHash(label: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function scriptLabel(
  role: 'lock' | 'type',
  script: SemanticScript | undefined,
): CellSemanticScriptLabel | null {
  const text = script?.name ?? script?.family;
  if (!text) return null;
  return { role, text, parameter: role === 'lock' ? 0.16 : 0.64 };
}

/** Derive bounded, deterministic overlay descriptors from an already anchored
 * record. Heuristic guesses are deliberately never read. */
export function deriveCellSemanticMorphologyOverlay(
  cell: Cell,
  record: CellSemanticRecord | null | undefined,
): CellSemanticMorphologyOverlay | null {
  if (!record || cellSemanticRecordMorphologyMismatch(cell, record)) return null;
  const scriptLabels = [
    scriptLabel('lock', record.lock_script),
    scriptLabel('type', record.type_script),
  ].filter((label): label is CellSemanticScriptLabel => label !== null);
  const totalBytes = cell.data_bytes;
  const dataSegments = (record.content?.deterministic?.segments ?? [])
    .map((segment) => ({
      label: segment.label,
      meaning: segment.meaning,
      value: segment.value,
      startByte: segment.start_byte,
      endByte: segment.end_byte,
      start: totalBytes > 0 ? segment.start_byte / totalBytes : 0,
      end: totalBytes > 0 ? segment.end_byte / totalBytes : 0,
      colorIndex: labelHash(`${segment.label}/${segment.meaning}`) % 4,
    }))
    .sort((left, right) => (
      left.startByte - right.startByte
      || left.endByte - right.endByte
      || left.label.localeCompare(right.label)
    ));

  const knowledge = record.common_knowledge;
  const knowledgeSegments: CellSemanticKnowledgeSegment[] = [];
  if (knowledge && knowledge.total_bytes > 0) {
    const parts = [
      ['capacity', knowledge.capacity_field_bytes],
      ['lock', knowledge.lock_script_bytes],
      ['type', knowledge.type_script_bytes],
      ['data', knowledge.data_bytes],
    ] as const;
    let offset = 0;
    for (const [role, bytes] of parts) {
      const start = offset / knowledge.total_bytes;
      offset += bytes;
      knowledgeSegments.push({
        role,
        bytes,
        start,
        end: offset / knowledge.total_bytes,
      });
    }
  }

  const supportedRoles = new Set(['dao', 'dep_group', 'code_cell']);
  const roleGlyphs = record.facets
    .filter((facet) => supportedRoles.has(facet.kind))
    .slice(0, 6)
    .map((facet, index) => ({
      role: facet.kind as CellSemanticRoleGlyph['role'],
      label: facet.state ?? facet.kind.replaceAll('_', ' ').toUpperCase(),
      parameter: (index + 1) / 7,
    }));

  if (
    scriptLabels.length === 0
    && dataSegments.length === 0
    && knowledgeSegments.length === 0
    && roleGlyphs.length === 0
  ) return null;
  const fingerprint = [
    record.source,
    ...scriptLabels.map((label) => `${label.role}:${label.text}`),
    ...dataSegments.map((segment) => `${segment.startByte}-${segment.endByte}:${segment.label}`),
    ...knowledgeSegments.map((segment) => `${segment.role}:${segment.bytes}`),
    ...roleGlyphs.map((glyph) => `${glyph.role}:${glyph.label}`),
  ].join('|');
  return {
    source: record.source,
    scriptLabels,
    dataSegments,
    knowledgeSegments,
    roleGlyphs,
    fingerprint,
  };
}
