import {
  type CSSProperties,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type {
  Cell,
  CellLink,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  ScriptId,
  SemanticContentSegment,
  SemanticFacet,
  SemanticScript,
  TransactionSemanticRecord,
} from '@cknerv/types';
import {
  formatCkb,
  formatAge,
  formatBlockRef,
  formatDataSize,
  formatLockKind,
  formatAssetKind,
  formatOutpoint,
  formatScriptIdentity,
  formatWallClock,
  midTruncate,
  scriptIdentityColor,
  LOCK_COLORS,
  ASSET_COLORS,
} from './cellFormat';
import type { CellById } from '../../types';
import { CELL_CARD_ACCENT, CJK_BASELINE_LIFT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import {
  CloseButton,
  DragAxisMark,
  moduleTag,
  PlateReadoutCaption,
  PlateReadoutRow,
  plateStateChip,
  PLATE_ROW_HOT_WASH_ALPHA,
  PLATE_ROW_RAIL_ALPHA,
  PLATE_ROW_RAIL_HOT_ALPHA,
  PLATE_ROW_SELECTED_WASH_ALPHA,
  REVEAL_GHOST_OPACITY,
  revealStageAttributes,
  revealStageStyle,
  satelliteBase,
  SpatialPlateHeader,
  spatialPlate,
  StatusLamp,
} from './primitives';
import { useReducedMotion } from './useReducedMotion';
import { useHudHoleWidth } from '../hudOcclusion';
import { INSPECTOR_EDGE_PX, INSPECTOR_GAP_PX } from '../sceneInspection';
import CellNucleusPortrait from './CellNucleusPortrait';
import { ConsensusMemoryTracePlate } from './ConsensusIdentityPlate';
import CellContentMemory from './CellContentMemory';
import CellDataReader, {
  READER_CHROME_PX,
  READER_ROW_HEIGHT_PX,
  READER_WIDTH_PX,
} from './CellDataReader';
import CellCausalLensReadout, {
  type CellCausalNavigationReadout,
} from './CellCausalLensReadout';
import CellByteBudget from './CellByteBudget';
import {
  CellScanClockContext,
  createCellScanClock,
  useCellScanClassified,
  useCellScanClock,
  useCellScanFrame,
  useCellScanMemoryProgress,
  useCellScanSelector,
  useCellScanStepLit,
} from './cellScanClock';
import {
  deriveCellConsensusIdentity,
  type CellWriteEvidence,
} from '../../derives/cellConsensusIdentity.derive';
import { deriveCellContentMemory } from '../../derives/cellContentMemory.derive';
import { validateCellSemanticRecordForMorphology } from '../../derives/cellSemanticMorphology.derive';
import { useCellOutputData } from '../../hooks/useCellOutputData';
import { READER_MIN_VISIBLE_ROWS, readerRowsUnderScan } from '../../derives/cellDataReader.derive';
import {
  deriveCellCausalLens,
  type CellCausalLens,
} from '../../derives/cellCausalLens.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceReadout,
  ConsensusMemoryTraceSource,
} from '../../nerve/consensusMemoryTrace';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementTarget,
  type ConsensusBraidField,
} from '../../derives/consensusBraid.derive';
import {
  cellIdentityProofBindingComplete,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';
import {
  compositionTierColor,
  compositionTierDescription,
  compositionTierLabel,
  enrichmentSourceColor,
  enrichmentStatusMessage,
  EvidenceFact,
  FacetEvidenceRow,
  primarySemanticFacet,
  semanticAssetAmountReadout,
  semanticAssetIdentityReadout,
  semanticFacetAttribute,
  semanticFacetNumber,
  semanticFacetValue,
  semanticObjectReadout,
  type CellSemanticsPhase,
} from './CellSemanticsReadout';

const EMPTY_RECENT_LINKS: readonly CellLink[] = [];
/** One empty list, for a record that decoded nothing. A fresh `[]` on every
 *  render would hand CKBYTES a new identity twelve times a second and re-run
 *  every memo it colours its bytes with. */
const EMPTY_CONTENT_SEGMENTS: readonly SemanticContentSegment[] = [];
const PORTRAIT_BRACKET_PX = 12;
/** The CELL SCAN square is an independent column beside the analysis plate:
 * 440 of analysis + an 8px seam + the 280 square, one constant geometry for
 * bare and enriched Cells alike. The analysis measure is set by its widest
 * row — a label, a badge and a mid-truncated hash — and every column past
 * that was empty gutter between a left label and a right-aligned value. */
const PORTRAIT_COLUMN_PX = 280;
/** Exported so `cellDataReader.derive.ts` can be pinned against them: the
 * derive restates 728 + 8 rather than importing this module (a pure derive may
 * not drag a 2,400-line panel behind it), and `CellDetailPanel.test.tsx`
 * asserts the two statements agree. */
export const CARD_SEAM_PX = 8;
const ANALYSIS_COLUMN_PX = 440;
export const CARD_WIDTH_PX = ANALYSIS_COLUMN_PX + CARD_SEAM_PX + PORTRAIT_COLUMN_PX;

/** How far CKBYTES reaches PAST the CELL SCAN square it stands under, toward
 *  the Cell the card points at — the user's R2-6 ruling of 2026-09-05.
 *
 * The reader is a fixed measure (a sixteen-byte row is 73 monospace characters
 * plus its scrollbar-map, which `READER_WIDTH_PX` derives to 408) and the
 * square is 280, so the overhang is what is left after the square and the seam
 * beside it. It is SUBTRACTED rather than declared, because three constants
 * that each state a piece of the same geometry can disagree and two that state
 * it once cannot: the notch, the reader's width and the card's width are one
 * arithmetic here, and moving `READER_WIDTH_PX` moves all three together.
 *
 * The notch is a `.` cell of the grid rather than an element, so nothing paints
 * in it and the card's dismiss boundary does not reach it — a click up there is
 * a click on the scene, which is what it is. */
const READER_NOTCH_PX = READER_WIDTH_PX - PORTRAIT_COLUMN_PX - CARD_SEAM_PX;

/** The wide card: the analysis plate, the scan square, and the reader standing
 *  beside them past the notch. */
const CARD_WIDE_WIDTH_PX = CARD_WIDTH_PX + CARD_SEAM_PX + READER_NOTCH_PX;

/** The clear stage the wide card needs before it may have its reader beside
 *  the plate. Under it the reader lies under the card instead and the card
 *  goes back to its 728 measure — and, under a second rung, below even that.
 *
 * The rule is keyed to the HOLE the HUD leaves — `hudHoleFromRects`, the same
 * reading the solver places into and the camera fits to — and not to
 * `innerWidth`, which was the first cut of this and was wrong in both
 * directions: it made a 1,600 px window with both rails out (a 1,216 px hole)
 * narrow, and it called a 1,400 px window with the rails collapsed wide when
 * the hole was 830.
 *
 * The arithmetic is the placement's own. A card is tethered `INSPECTOR_GAP_PX`
 * from its entity, so a card of measure `w` beside an entity in the hole needs
 * `w + 42` of hole. That gives a ladder with three rungs:
 *
 *   hole ≥ 898  the wide card, reader beside the plate
 *   hole ≥ 770  the 728 card, reader under it — still placed beside the cell
 *   below       a COMPACT card, `clamp(hole − 28, 640, 728)`, reader under it
 *
 * A 1,920 stage leaves 1,190 and takes the first rung. A 1,440 collapses its
 * rails (`HudOverlay.RAILS_COLLAPSE_MAX_WIDTH_PX`) and is left with 874, so it
 * takes the middle one — and the only thing the wide card was buying there was
 * a taller dump. So the dump gives up its height instead: six rows under the
 * two columns, the card at the measure it has when a Cell holds nothing, and a
 * composition the stage can hold.
 *
 * This is the `readerPlacement(innerWidth) >= 1396 ? 'beside' : 'below'` rule
 * the R2 rewrite removed and never replaced, restated in the terms that
 * actually decide it: card, tether and hole. */
const CARD_BESIDE_HOLE_PX = CARD_WIDE_WIDTH_PX + INSPECTOR_GAP_PX;

/** The hole the 728 card needs to stand beside its cell — the middle rung. */
const CARD_NARROW_HOLE_PX = CARD_WIDTH_PX + INSPECTOR_GAP_PX;

/** What the compact measure gives back to the stage: the solver's own edge, on
 *  both sides. A card takes its measure from the hole, and the hole is a stage
 *  the card has to land INSIDE — with the clearance every family keeps against
 *  the viewport edge. Derived from `INSPECTOR_EDGE_PX` rather than typed,
 *  which is also what the `maxWidth` below is made of: one 28. */
const CARD_EDGE_RESERVE_PX = INSPECTOR_EDGE_PX * 2;

/** The compact card's floor — what the analysis column may not go under.
 *
 * The card's third rung is the one the 1,280 stage lands on: 714 px of hole
 * against a 728 card, short by fourteen, and A2b put that arithmetic to the
 * user as an open question. The ruling: below the middle rung the card takes
 * a COMPACT measure and gives the difference back to the stage — but only the
 * ANALYSIS column shrinks. The 280 scan square is a specimen at a fixed scale
 * and the 8 px seam is the card's own joint; a square that flexed would be a
 * second reading of the braid at a second size.
 *
 * So the floor is the analysis plate's own: the longest row it draws — a
 * label, a badge and a mid-truncated hash — measures 336 px, and 640 − 280 −
 * 8 leaves it 352. A pixel under this and the register starts wrapping rows
 * that were composed as one line; the card would rather cover a rail (and be
 * dimmed under its scan square, A3) than print a broken register. */
const CARD_COMPACT_MIN_WIDTH_PX = 640;

/**
 * The card's measure, from the hole the HUD leaves and whether the reader is
 * standing beside the plate. Pure, and stated once: the width, the grid and
 * the reader's own placement are three readings of this one ladder.
 */
function cellCardWidth(holeWidth: number, readerBeside: boolean): number {
  if (readerBeside) return CARD_WIDE_WIDTH_PX;
  if (holeWidth >= CARD_NARROW_HOLE_PX) return CARD_WIDTH_PX;
  return Math.round(Math.min(
    CARD_WIDTH_PX,
    Math.max(CARD_COMPACT_MIN_WIDTH_PX, holeWidth - CARD_EDGE_RESERVE_PX),
  ));
}

/**
 * Whether the stage is narrower than the card's own floor — the one case the
 * placement solver has no answer for.
 *
 * The ladder above ends at 640 because the register stops being a register
 * under it, so below a 640 hole the card is wider than the clear stage and
 * lands ON the HUD, whatever the solver does with it. That is the state this
 * predicate names, and it is the user's ruling of 2026-09-05: where the card
 * cannot clear the panels, the panels give way for as long as it is open.
 *
 * A3 already dims what shows through the CELL SCAN square, because a chain tip
 * printed across a specimen is a false reading of the specimen. This is the
 * same argument one step out, and the reason it needs its own rung is that the
 * rest of the card is OPAQUE: a panel under it is not misread, it is CUT — a
 * summary sheared down the middle by a card's edge, its rows half-legible and
 * its rule ending in mid air. A panel at a quarter of its light reads as a
 * panel that has stood aside; a panel with a card's edge through it reads as a
 * panel that has broken. So the whole card's box is what the panels answer to
 * here, and the square's box is what they answer to everywhere else.
 *
 * Exported for `CellInspectionOverlay`, which owns the mark: the ladder is the
 * card's, the DOM write is the overlay's, and neither restates the other's
 * number.
 */
export function cellCardStandsOnHud(holeWidth: number): boolean {
  return Number.isFinite(holeWidth) && holeWidth < CARD_COMPACT_MIN_WIDTH_PX;
}

/** What a docked card may not have of the viewport's height: the HUD's safe
 *  top and the bottom edge, the two numbers `sceneInspectorPlacement` clamps
 *  a card between (`INSPECTOR_SAFE_TOP_PX` 104 + `INSPECTOR_EDGE_PX` 14). The
 *  card's cap has to be the solver's band exactly — a card capped shorter
 *  would leave the docked family on the next frame and a card capped taller
 *  would still hang off the screen. */
const CARD_DOCK_RESERVE_PX = 118;

/** Panel-local display order — the vertical order the six facts occupy in the
 * merged CKBYTES ANALYSIS layout, used ONLY for probe-reveal indexing so the
 * lattice lights top→down through the register into the bytes zone. Braid
 * semantics and the agreement math stay on CONSENSUS_BRAID_FIELDS. */
const CKBYTES_REVEAL_ORDER: readonly ConsensusBraidField[] = [
  'lock',
  'asset',
  'state',
  'born',
  'capacity',
  'data',
];

/** Evidence hangs under the fact it explains, in every cluster. */
const CLUSTER_EVIDENCE_INDENT = '3px 0 0 11px';

// ——— Where the memory pieces join the walk —————————————————————————————
// Fractions of the SCAN, not seconds: the probe's step length is the single
// speed dial (`PROBE_STEP_S`), and every gate below rides on its percentage
// so changing the pace moves all of them together.
/** Content memory finishes decoding a little before the lattice locks. */
const CONTENT_DECODED_AT = 0.72;
/** ORIGIN resolves once the register is essentially read. */
const CAUSAL_REVEALED_AT = 0.76;
/** The MEMORY TRACE affordance arms last, just under the lock. */
const TRACE_REVEALED_AT = 0.9;

/** One rail-hung evidence row: a 3px lead, a 9px value line, a 4px tail.
 *  Reservation math only — the browser lays the real rows out. */
const EVIDENCE_ROW_PX = 20;
const EVIDENCE_ROW_GAP_PX = 3;
/** A micro caption under a value is a SECOND line in its row. OWNER carries
 *  one, so its reservation has to carry one too — otherwise the slot grows a
 *  caption's worth of height the moment the record lands in it. */
const EVIDENCE_CAPTION_PX = 12;
/** OWNER · SCRIPT · ARGS — what the index adds to a lock, every time. No
 *  captions among them any more: OWNER's provenance sentence moved to the
 *  row's `title` (the user's D-19 ruling), so the slot reserves rows only. */
const LOCK_ENRICHMENT_ROWS = 3;
const LOCK_ENRICHMENT_CAPTIONS = 0;
/** The typical asset block: two of amount/identity/object plus script hash. */
const ASSET_ENRICHMENT_ROWS = 3;
/** The CKBYTE budget is one instrument (header, bar, legend, ratio strip), not
 *  a row stack — but three ghost rows is what stands in for it, and a slot
 *  must reserve EXACTLY the ghost that fills it or it settles by the
 *  difference the moment the record arrives. One number, one function. */
const BYTE_BUDGET_GHOST_ROWS = 3;

function reservedEvidenceHeight(rows: number, captions = 0): number {
  return rows * EVIDENCE_ROW_PX
    + Math.max(0, rows - 1) * EVIDENCE_ROW_GAP_PX
    + captions * EVIDENCE_CAPTION_PX;
}

// The card INTERIOR's vocabulary, and deliberately not the card's identity:
// cyan is what plain consensus content looks like everywhere in this HUD (the
// DATA fact, the DATA byte segment, the default lock), violet is the
// consensus-memory family. The frame around all of it is `CELL_CARD_ACCENT` —
// see the identity note in `hudTheme.ts`. Do not collapse the two: the border
// says which organism this window is about, the body says what it holds.
const CYAN = HUD_COLORS.cyanWire;
const VIOLET = HUD_COLORS.memory;
// Chrome orange, and named for what it is. The palette carries two real golds
// (`lockedGold`, `goldInk`) for locked value and value emphasis; the affordance
// rows down here are neither, and an alias claiming otherwise sent the next
// reader looking for a gold that was never on screen.
const ORANGE = HUD_COLORS.orange;

// ——— Provenance footer captions ——————————————————————————————————————
// Every row down here names a piece of record-keeping, and a label alone
// leaves the reader to guess which one. One short sentence each, in the house
// caption grammar: what the row is, never a second number.
/** MEMORY TRACE exists only while the creating link is still in the retained
 *  causal ring — that retention IS the row. */
const TRACE_CAPTION = 'THE CREATING WRITE THIS SESSION STILL HOLDS IN MEMORY';
const TRACE_CAPTION_RECALL = `${TRACE_CAPTION} · SELECT TO REPLAY ITS INPUTS`;
/**
 * …and what the caption says while the affordance is still DISABLED.
 *
 * The control arms only after the three identity proofs are read, and the
 * whole instruction for reading them lived in a `title` on a disabled element
 * — a tooltip most browsers will not even show for one — while the caption
 * under it invited a click it would refuse. A caption on a disabled control
 * has exactly one job: name the unmet condition.
 *
 * WHERE · WHAT · WHEN are the register's own labels for the three facts
 * (D-6 renamed STATE to WHERE for this reason), and `VERIFY ◇◇◇ 0/3` beside
 * it is the count, so the sentence and the mark say the same thing.
 */
const TRACE_CAPTION_UNARMED = 'READ WHERE · WHAT · WHEN ABOVE TO ARM';
/** PROOF is the index's anchor block: the height everything the index added
 *  above was true at — said on the row, on hover, and not printed under it.
 *
 *  The user's D-19 ruling of 2026-09-05 kept ORIGIN TX's caption and moved the
 *  other three explainers to `title`. This is one of the three: it is the same
 *  sentence on every card that has an index record at all, it explains the row
 *  rather than reading anything off this Cell, and it was the widest line in
 *  the provenance footer. ORIGIN TX's caption stays a caption because it names
 *  a relationship a reader cannot deduce from the row (that THIS transaction
 *  is the one that created THIS Cell); this one names a convention. */
const PROOF_TITLE = 'ENRICHMENT ANCHOR · EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK';

/** A register row's READING: the words, and the ink they are printed in. The
 *  ink is optional because two facts are printed in body ink on purpose — see
 *  `cellScanFactAccent`, which is where the row's FRAME colour comes from. */
type RowDecode = { label: string; value: string; color?: string };
export type CellInspectionFacet = ConsensusBraidField;
export type CellDetailLayoutSide = 'left' | 'right' | 'above' | 'below';

/** The colour ONE fact answers in — its rail, its selected wash, and the
 *  scene tether the overlay draws while that fact is open. Exported because
 *  the two surfaces live in two files, and they had drifted apart: the tether
 *  kept its own copy of this table, so COMMIT lit an orange line beside a cyan
 *  button and an unrecognized script drew a near-black tether beside an `ink`
 *  row. One function, asked by both.
 *
 *  Separate from `RowDecode.color` because a frame and a reading are not the
 *  same job. COMMIT is the case that proves it: the anchor is a house fact, so
 *  its frame is the instrument's own orange — but a READING may never be
 *  painted in chrome, so the block reference stays body ink until the fact is
 *  selected. CAPACITY reads the same way, in the consensus cyan its bytes zone
 *  is ruled with.
 *
 *  STATE is the same split running the other way, and it is why this function
 *  may not simply return whatever the word is printed in: chrome may FRAME a
 *  fact it may not be read as, and `ember` may be READ as a fact it may not
 *  frame. Nothing this function answers is allowed to be a metabolic tone —
 *  `CellInspectionOverlay.test.ts` walks every branch of it against that. */
export function cellScanFactAccent(
  cell: Cell,
  field: CellInspectionFacet,
  record?: CellSemanticRecord | null,
): string {
  switch (field) {
    case 'lock':
      return scriptIdentityColor(cell.lock_kind, LOCK_COLORS, record?.lock_script);
    case 'asset':
      return scriptIdentityColor(cell.asset_kind, ASSET_COLORS, record?.type_script);
    case 'born':
      return ORANGE;
    // CAPACITY, DATA and STATE are all plain consensus content — what the
    // chain says this output occupies, what it carries, and whether it is
    // still there to carry it.
    //
    // STATE arrived at that default the same way COMMIT arrived at chrome, and
    // for the mirror-image reason. It used to answer `nominal` for a live Cell
    // and `caution` for a spent one, which is a severity ramp spent on the one
    // event this HUD is most certain is not a fault: a Cell being consumed is
    // metabolism, and a chain that stopped spending its outputs would be the
    // emergency. The house already cut a colour for it — `ember` — and this
    // slot cannot take it, because what comes out of this function is a 1px
    // rail, a selected wash, a 3px lamp and a leader line drawn across the
    // stage, and `ember` is documented as never a border. So the FRAME says
    // which kind of fact this is, in the cyan its two siblings wear, and the
    // WORD says which state it is in — see `DECODE.state`, where the metabolic
    // pair lives.
    default:
      return CYAN;
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/** What one staged step of the walk does to a row: ink, and only ink. The row
 *  is already standing at its final size — this turns it up. */
function revealInk(revealed: boolean): CSSProperties {
  return { opacity: revealed ? 1 : 0, transition: 'opacity 260ms ease' };
}

function portraitBracket(corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties {
  const vertical: CSSProperties = corner[0] === 't'
    ? { top: 0 }
    : { bottom: 0 };
  const horizontal: CSSProperties = corner[1] === 'l'
    ? { left: 0 }
    : { right: 0 };
  const borderWidth = corner === 'tl'
    ? '1px 0 0 1px'
    : corner === 'tr'
      ? '1px 1px 0 0'
      : corner === 'bl'
        ? '0 0 1px 1px'
        : '0 1px 1px 0';
  return {
    position: 'absolute',
    zIndex: 4,
    width: PORTRAIT_BRACKET_PX,
    height: PORTRAIT_BRACKET_PX,
    borderColor: HUD_COLORS.orange,
    borderStyle: 'solid',
    borderWidth,
    opacity: 0.82,
    pointerEvents: 'none',
    ...vertical,
    ...horizontal,
  };
}

export interface CellDetailPanelProps {
  cell: Cell;
  recentLinks?: readonly CellLink[];
  /** Current projection records used to explain exact route-hop identities. */
  routeCellById?: ReadonlyMap<number, Cell>;
  /** Shared scene/HUD model of the selected Cell's real origin transaction. */
  causalLens?: CellCausalLens | null;
  /** Local browser-like path through explicit causal endpoint selections. */
  causalNavigation?: CellCausalNavigationReadout | null;
  tracedWriteSeq?: number | null;
  traceSource?: ConsensusMemoryTraceSource;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
  traceEvidencePreviewSourceId?: number | null;
  onTraceEvidenceFocusChange?: (sourceId: number | null) => void;
  traceRouteHopFocus?: ConsensusMemoryRouteHopFocus | null;
  onTraceRouteHopFocusChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  traceRouteHopLock?: ConsensusMemoryRouteHopFocus | null;
  onTraceRouteHopLockChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  identityProofBinding?: CellIdentityProofBinding | null;
  onTraceWrite?: (linkSeq: number) => void;
  onIdentityProofRead?: (
    kind: CellIdentityProofKind,
    cellId: number,
    reducedMotion: boolean,
  ) => void;
  /** Owns pointer orbit gestures inside the nested Cell Scan renderer. */
  onScanInteractionChange?: (active: boolean) => void;
  semanticSource?: EnrichmentSourceStatus;
  semanticPhase?: CellSemanticsPhase;
  semanticRecord?: CellSemanticRecord | null;
  semanticMessage?: string | null;
  semanticTransactionPhase?: CellSemanticsPhase;
  semanticTransactionRecord?: TransactionSemanticRecord | null;
  semanticTransactionMessage?: string | null;
  /** Mirrors a selected readout facet into the scene-to-detail connector. */
  onInspectionFieldChange?: (field: CellInspectionFacet | null) => void;
  /** Spatial fan direction selected by the scene-anchor placement solver. */
  layoutSide?: CellDetailLayoutSide;
  /** The card is taller than the band the viewport leaves it, so the solver
   *  docked it under the strip. Its own dossier is then what has to give: the
   *  analysis plate scrolls inside the card instead of hanging the provenance
   *  footer off the bottom of the screen. */
  docked?: boolean;
  /** Review labs render the portrait as a self-contained Canvas instead of
   * through the app's main-context inset pass. */
  portraitStandalone?: boolean;
  onClose: () => void;
  style?: CSSProperties;
}

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

/** The DATA fact states how big the output data IS, from the exact count the
 *  Cell carries — never from the bounded hex preview beside it, which stops
 *  at 1 KiB and used to turn a 100 KB Cell into `1024 B+`. The preview's
 *  truncation is a fact about our window, and the content memory below is
 *  where that window admits it. */
function formatCellData(dataBytes: number): string {
  return dataBytes > 0 ? formatDataSize(dataBytes) : 'Empty';
}

/** A script's identity as the CELL itself carries it — the code it runs and
 *  the rule that matches it. No index required: this is canonical. */
function scriptCodeReadout(script: ScriptId): string {
  return `${midTruncate(script.code_hash, 12, 9)} · ${script.hash_type.toUpperCase()}`;
}

/** Args, or the honest word for none. `0x` beside a label reads as a bug. */
function scriptArgsReadout(args: string): string {
  const trimmed = args.trim();
  return trimmed === '' || trimmed === '0x' ? 'EMPTY' : midTruncate(trimmed, 14, 10);
}

/** The lifecycle word the index attaches to a script, as a chip beside the
 *  CODE row's label — the state belongs to the script it qualifies, not to a
 *  stamp floating at the far edge of the plate. */
function scriptStateChip(script: SemanticScript | null | undefined): ReactNode {
  if (!script || script.deprecated !== true) return undefined;
  // ⭐ ONLY the exception is printed. `ACTIVE` used to ride both CODE rows of
  // nearly every card in the set — two chips saying that nothing is wrong,
  // twice per Cell, on the ordinary case. A chip is a mark that something is
  // WORTH NOTICING; a chip that is always there marks nothing and reads as
  // decoration on the row it qualifies. The absence of a chip is the ordinary
  // condition, stated by not being stated. (The colour half of this argument
  // was settled in round 2 and stands: the pair was `nominal` over `danger`,
  // the whole severity ramp spent on a word an upstream registry attaches to a
  // CODE HASH — and a Cell locked by a superseded script is not a reorg.)
  //
  // DEPRECATED keeps the middle rung of the ramp, which is the one judgement
  // here rather than a deduction: it is the same shape as the DOSSIER's
  // IDENTIFY row two files over, where an upstream identity that agrees is
  // `dim` and one that disagrees is `caution`. A superseded script is worth
  // noticing and is not worth an alarm, which is exactly what the middle of
  // the ramp is for.
  return (
    <span
      data-cell-script-state="deprecated"
      style={{ flex: '0 0 auto', ...plateStateChip(HUD_COLORS.caution) }}
    >
      DEPRECATED
    </span>
  );
}

/** A DAO moment: the block it happened in, and — once the source states the
 *  timestamp — the wall clock a human remembers it by.
 *
 * ⚠️ …unless that block is the Cell's own birth block, which for a DEPOSITED
 *  row it almost always is: a deposit CREATES the Cell, so the register's
 *  COMMIT fact, ORIGIN TX and this row were three prints of one number on one
 *  card. Then the row states the clock alone — which is the half COMMIT does
 *  not carry, and the reason a reader is looking at this row at all — and says
 *  nothing when there is no clock either, because a lone repeated block
 *  number is the redundancy itself. */
function daoMomentReadout(
  facet: SemanticFacet,
  blockKey: string,
  atMsKey: string,
  birthBlock?: number,
): string | null {
  const block = semanticFacetNumber(facet, blockKey);
  if (block === null) return null;
  const atMs = semanticFacetNumber(facet, atMsKey);
  const clock = atMs !== null && atMs > 0 ? formatWallClock(atMs) : null;
  if (block === birthBlock) return clock;
  return clock === null ? formatBlockRef(block) : `${formatBlockRef(block)} · ${clock}`;
}

/** Facet kinds the register spells out one fact to a line. Everything else
 *  keeps the generic one-line summary — and a kind listed here that stayed out
 *  of this set would print twice, once as its own rows and once as the primary
 *  facet's one-liner underneath them. */
const SPELLED_OUT_FACET_KINDS = new Set(['dao', 'collection', 'composition']);

/** A count an index stated about itself, grouped in the house's pinned
 *  locale so a population cannot read differently on two machines. */
function groupCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** What a collection is MADE OF, in as many of its three facts as the index
 *  stated: how many objects are alive, how many wallets hold one, and how much
 *  CKB the whole population has locked up. A fact that never arrived is absent
 *  rather than zero — a collection with no stated population is not a
 *  collection of none. */
function collectionPopulationReadout(
  facet: SemanticFacet | null,
): string | null {
  const parts: string[] = [];
  const live = semanticFacetNumber(facet, 'live_items');
  if (live !== null) parts.push(`${groupCount(live)} LIVE`);
  const holders = semanticFacetNumber(facet, 'holders');
  if (holders !== null) parts.push(`${groupCount(holders)} HOLDERS`);
  // Shannons, and read off the attribute itself: `semanticFacetValue` appends
  // the unit, which would print `109067222027837 shannons` in the one place
  // the house CKB grammar belongs. A figure that will not parse is withheld —
  // the row simply states the facts it does have.
  const capacity = semanticFacetAttribute(facet, 'owned_capacity')?.value;
  if (capacity) {
    try {
      parts.push(formatCkb(BigInt(capacity)));
    } catch {
      // Not a decimal integer: nothing truthful to print, so nothing is.
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The three tiers a collection's census names outright, in the order it names
 *  them. On-chain and pure are not in this list because they do not read as
 *  siblings of it: `agg_onchain` is the index's own field and already counts
 *  the BTC+CKB objects among the pure ones, `agg_pure_ckb` is the subset that
 *  never leaves CKB, and the wire carries no separate BTC figure. So the pure
 *  count is stated INSIDE the on-chain one wherever both arrived, rather than
 *  beside it as if the two could be added up — and both readouts below fold it
 *  the same way. */
const COMPOSITION_MIX_TERMS = [
  ['agg_decentralized', 'DECENTRALIZED'],
  ['agg_centralized', 'CENTRALIZED'],
  ['agg_unknown', 'UNKNOWN'],
] as const;

/** The population's storage mix as a COUNT breakdown, EVERY count the index
 *  stated — the block's provenance, where a reader who wants the whole census
 *  goes. Never a ratio and never a bar: the question a reader has about a
 *  collection is how many of its objects sit in each tier, and a percentage of
 *  a population whose size is stated a row above says nothing the two numbers
 *  do not already. Counts the index never stated are simply not listed; a
 *  count it stated as zero IS a fact and is listed. */
function compositionCountsReadout(
  facet: SemanticFacet | null,
): string | null {
  const count = (key: string) => semanticFacetNumber(facet, key);
  const parts: string[] = [];
  const onchain = count('agg_onchain');
  const pure = count('agg_pure_ckb');
  if (onchain !== null) {
    parts.push(pure !== null
      ? `on-chain ${groupCount(onchain)} (pure ${groupCount(pure)})`
      : `on-chain ${groupCount(onchain)}`);
  } else if (pure !== null) {
    parts.push(`pure ${groupCount(pure)}`);
  }
  for (const [key, word] of COMPOSITION_MIX_TERMS) {
    const value = count(key);
    if (value !== null) parts.push(`${word.toLowerCase()} ${groupCount(value)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The same mix, printed. A tier holding NONE of a collection's objects is a
 *  term that costs a reader a glance and tells them nothing — `unknown 0` on
 *  screen is four characters saying the census is complete, which the four
 *  terms beside it already said. So the visible line omits the empty tiers and
 *  the title keeps them, and the two functions differ in exactly that. */
function compositionMixReadout(facet: SemanticFacet | null): string | null {
  const count = (key: string) => {
    const value = semanticFacetNumber(facet, key);
    return value !== null && value > 0 ? value : null;
  };
  const parts: string[] = [];
  const onchain = count('agg_onchain');
  const pure = count('agg_pure_ckb');
  if (onchain !== null) {
    parts.push(pure !== null
      ? `${groupCount(onchain)} ON-CHAIN (${groupCount(pure)} PURE)`
      : `${groupCount(onchain)} ON-CHAIN`);
  } else if (pure !== null) {
    parts.push(`${groupCount(pure)} PURE`);
  }
  for (const [key, word] of COMPOSITION_MIX_TERMS) {
    const value = count(key);
    if (value !== null) parts.push(`${groupCount(value)} ${word}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The content issues the index's decode worker found in THIS object — a
 *  source it could not read, media dangling off a dead reference — as a chip
 *  on the COMPOSITION heading, in the same grammar the CODE row's lifecycle
 *  word wears. Upstream emits the key only once there is something to count,
 *  so a chip present at all means a number greater than zero, and only a spore
 *  ever carries one: M-NFT publishes no per-item media profile to find issues
 *  in. The attribute keeps its old `storage` spelling — the row it was named
 *  for is gone, but the oracles that read it are not. */
function compositionIssuesChip(issues: string | null): ReactNode {
  if (!issues) return null;
  return (
    <span
      data-cell-storage-issues={issues}
      title={`${issues} content issue${issues === '1' ? '' : 's'} reported by the index.`}
      style={{ flex: '0 0 auto', marginLeft: 'auto', ...plateStateChip(HUD_COLORS.caution) }}
    >
      {`${issues} ISSUES`}
    </span>
  );
}

type ClusterRowProps = {
  row: string;
  accent: string;
  label: string;
  value: string;
  valueColor?: string;
  valueSize?: number;
  title?: string;
  badge?: ReactNode;
  caption?: string;
  /** The walk step this row's ink waits for. Omitted, the row is simply lit:
   *  every row is mounted at final geometry either way. */
  revealAt?: number;
  style?: CSSProperties;
};

/** One line of cluster evidence in the house row grammar: rail, micro label,
 *  value hard against the right edge of the plate's measure. */
function ClusterRow({
  row,
  accent,
  label,
  value,
  valueColor,
  valueSize = HUD_TYPE.label,
  title,
  badge,
  caption,
  revealAt,
  style,
}: ClusterRowProps) {
  const revealed = useCellScanStepLit(revealAt ?? 0);
  const inkStyle = revealAt === undefined
    ? style
    : { ...style, ...revealInk(revealed) };
  return (
    <PlateReadoutRow
      accent={accent}
      label={label}
      value={value}
      valueColor={valueColor}
      valueSize={valueSize}
      title={title}
      badge={badge}
      rowAttributes={{ 'data-cell-evidence-row': row }}
      valueAttributes={{ 'data-cell-evidence-value': row }}
      style={inkStyle}
    >
      {caption ? <PlateReadoutCaption>{caption}</PlateReadoutCaption> : null}
    </PlateReadoutRow>
  );
}

/** WHERE a digital object's content physically lives — the durability half of
 *  what it is worth — as one tinted card under the OBJECT row that names it.
 *
 *  It replaces two rows that said the same sentence twice: the collection's
 *  aggregate tier and this object's own. They were never two facts a reader
 *  was comparing — an object measured on its own account IS the answer, and the
 *  population's mix is the answer only when nobody measured this one. The index
 *  already resolves that, and the facet's `state` is the resolution, so this
 *  block reads the headline rather than choosing between two attributes or
 *  recomputing one from the other.
 *
 *  A card rather than a row because the fact outranks its neighbours: ckbadger
 *  states it as a tinted card too, and this is that card in HUD type — the
 *  tier's colour on the leading edge and washed faintly behind the words, so
 *  the durability reads off the shape of the block before a word of it does. */
function CompositionBlock({ tier, mix, issues, title, revealAt }: {
  /** The wire spelling of the headline tier — the block's live oracle. */
  tier: string;
  /** Counts line, empty tiers already omitted, or null when none arrived. */
  mix: string | null;
  issues: string | null;
  title?: string;
  revealAt: number;
}) {
  const revealed = useCellScanStepLit(revealAt);
  const color = compositionTierColor(tier);
  return (
    <div
      data-cell-composition-block={tier}
      title={title}
      style={{
        minWidth: 0,
        padding: '3px 8px 4px',
        // The rail every evidence row hangs on, twice as thick and in the
        // tier's own colour: this is a card among rows, and the edge is what
        // says so before the type does.
        borderLeft: `2px solid ${rgba(color, 0.55)}`,
        // A wash, never a fill. The plate under this block is near-opaque by
        // construction and everything inside it tints DOWN onto that ground —
        // a tint heavy enough to read as a surface of its own would lift the
        // block off the plate it belongs to, which is the one thing the plate
        // grammar does not allow.
        background: rgba(color, 0.07),
        ...revealInk(revealed),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ flex: '0 0 auto', fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
          COMPOSITION
        </span>
        {compositionIssuesChip(issues)}
      </div>
      <div
        data-cell-composition-tier={tier}
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: HUD_TYPE.value, lineHeight: 1.2, color }}
      >
        {compositionTierLabel(tier)}
      </div>
      {mix ? (
        <PlateReadoutCaption style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span data-cell-composition-counts="true">{mix}</span>
        </PlateReadoutCaption>
      ) : null}
    </div>
  );
}

/** The slot an expected record will fill, holding its height in advance. A
 *  card that grows a row under the reader's eyes is a card that moved while
 *  they were reading it. The first `captions` ghosts wear the second line a
 *  captioned row carries, so the stack measures exactly what the slot
 *  reserved for it. */
function GhostRows({ rows, captions = 0, accent }: {
  rows: number;
  captions?: number;
  accent: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-cell-evidence-ghost={rows}
      style={{ display: 'grid', alignContent: 'start', gap: EVIDENCE_ROW_GAP_PX, minWidth: 0, opacity: REVEAL_GHOST_OPACITY }}
    >
      {Array.from({ length: rows }, (_, index) => {
        const captioned = index < captions;
        return (
          <span
            key={index}
            style={{ display: 'block', height: EVIDENCE_ROW_PX + (captioned ? EVIDENCE_CAPTION_PX : 0), borderLeft: `1px solid ${rgba(accent, PLATE_ROW_RAIL_ALPHA)}` }}
          >
            <span style={{ display: 'block', height: 1, margin: '9px 0 0 9px', background: HUD_COLORS.dim }} />
            {captioned ? (
              <span style={{ display: 'block', width: '46%', height: 1, margin: '7px 0 0 9px', background: HUD_COLORS.dim, opacity: 0.6 }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

type CellScanFactProps = RowDecode & {
  field: CellInspectionFacet;
  /** The fact's frame colour, from `cellScanFactAccent` — never defaulted
   *  here. A local fallback is what let COMMIT sit in cyan while the tether it
   *  is supposed to agree with went orange, for as long as nobody opened both
   *  at once. */
  accent: string;
  /** The walk step that lights this fact, 1-based in panel display order. */
  revealAt: number;
  selected: boolean;
  /** Identity-proof carrier state — only STATE / DATA / COMMIT bear one. */
  proof?: { read: boolean };
  onActivate: (field: CellInspectionFacet) => void;
};

const CellScanFact = memo(function CellScanFact({
  field,
  label,
  value,
  color,
  accent,
  revealAt,
  selected,
  proof,
  onActivate,
}: CellScanFactProps) {
  // Each fact watches its own step of the walk and the lock at the end of it,
  // so a tick wakes six buttons at most — and only on the tick that changed
  // one of their two booleans.
  const revealed = useCellScanStepLit(revealAt);
  const interactive = useCellScanClassified();
  // Pointed at, or focused from the keyboard: one state, because they are one
  // question — is the reader ABOUT to press this? React state and inline
  // styles rather than a `:hover` rule, and the reason is mechanical: every
  // property the treatment touches is written inline from this fact's own
  // accent, and an inline style beats a stylesheet rule. (Measured live: the
  // first cut of this WAS a theme rule, and the hovered rail and the resting
  // one came back byte-identical.)
  const [hot, setHot] = useState(false);
  const lit = interactive && hot;
  return (
    <button
      type="button"
      data-cell-detail-field={field}
      data-cell-detail-field-state={selected ? 'focused' : revealed ? 'resolved' : 'scanning'}
      // A fact is a button, and the rail is what says so.
      data-hud-fact-rail={lit ? 'hot' : 'true'}
      aria-pressed={selected}
      disabled={!interactive}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      onClick={() => onActivate(field)}
      style={{
        position: 'relative',
        minWidth: 0,
        // A register of six two-line facts is a quarter of the column; the
        // slack inside each one bought nothing but height. The fact still
        // outranks the evidence under it — label over value, its own rail —
        // it just stops reserving a row it does not fill.
        minHeight: 36,
        margin: 0,
        padding: '4px 7px 4px 10px',
        border: 0,
        borderLeft: `1px solid ${selected || lit
          ? rgba(accent, PLATE_ROW_RAIL_HOT_ALPHA)
          : rgba(accent, PLATE_ROW_RAIL_ALPHA)}`,
        background: selected || lit
          ? `linear-gradient(90deg,${rgba(
            accent,
            selected ? PLATE_ROW_SELECTED_WASH_ALPHA : PLATE_ROW_HOT_WASH_ALPHA,
          )},transparent 88%)`
          : 'transparent',
        boxShadow: selected ? `-3px 0 10px ${rgba(accent, 0.22)}` : undefined,
        color: accent,
        font: 'inherit',
        textAlign: 'left',
        // ONE cursor for a pressable. `crosshair` said AIM on the facts and the
        // route hops while fourteen other controls said PRESS with `pointer` —
        // two grammars for one act, and the aiming one on the surface a reader
        // is least likely to know is a control at all.
        cursor: interactive ? 'pointer' : 'default',
        opacity: revealed ? 1 : REVEAL_GHOST_OPACITY,
        transition: 'opacity 260ms ease, background 160ms ease, box-shadow 160ms ease',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {/* THE ROOMY REGISTER. `PeerLinkCard`'s `PeerScanFact` prints the same
          sentence one rung tighter (micro/label to this one's label/value);
          both are declared in the tracking ledger in `hudTheme.ts`. This card
          is 440px in a single column, so it can afford the larger pair — the
          peer card, at 340px and two facts to a row, cannot. Neither size is
          the "right" one to standardise on. */}
      <span data-hud-fact-label style={{ display: 'block', fontSize: HUD_TYPE.label, letterSpacing: 1.2, color: lit ? HUD_COLORS.ink : HUD_COLORS.dim }}>
        {label}
        {proof ? (
          <span
            data-cell-detail-proof-mark={proof.read ? 'read' : 'unread'}
            title={proof.read
              ? 'IDENTITY PROOF · READ'
              : 'IDENTITY PROOF · select to read — all three arm MEMORY TRACE'}
            style={{ marginLeft: 5, color: proof.read ? HUD_COLORS.lockedGold : HUD_COLORS.dim, opacity: proof.read ? 1 : 0.75 }}
          >
            {proof.read ? '◆' : '◇'}
          </span>
        ) : null}
      </span>
      <span
        title={revealed ? value : undefined}
        // The value itself stays dark until the probe reaches this facet —
        // a ghosted-but-readable value made the reveal read as sluggish UI
        // instead of discovery.
        style={{ display: 'block', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: HUD_TYPE.value, lineHeight: 1.2, color: selected ? accent : color ?? HUD_COLORS.ink, opacity: revealed ? 1 : 0, transition: 'opacity 260ms ease' }}
      >
        {value}
      </span>
      <span
        aria-hidden="true"
        style={{ position: 'absolute', left: -2, top: 5, width: 3, height: 3, background: revealed ? accent : 'transparent', boxShadow: revealed ? `0 0 6px ${accent}` : undefined }}
      />
    </button>
  );
}, (previous, next) => (
  previous.field === next.field
  && previous.label === next.label
  && previous.value === next.value
  && previous.color === next.color
  && previous.revealAt === next.revealAt
  && previous.selected === next.selected
  && previous.proof?.read === next.proof?.read
  // The handler carries the reduced-motion answer the proof read reports, so
  // it is a value here, not plumbing to be skipped.
  && previous.onActivate === next.onActivate
));

// ——— The leaves the walk wakes ————————————————————————————————————————
// Everything below subscribes to the scan clock on its own account. That is
// the whole point: the card body is rendered once per selection, and a tick
// re-renders only the handful of leaves whose own slice of the walk moved.

/** A block of evidence whose ink waits for a step of the walk. Same div, same
 *  attributes, same place in the grid — it was never anything but opacity. */
function CellScanStagedBlock({ revealAt, attributes, style, children }: {
  revealAt: number;
  attributes?: Record<string, string | undefined>;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const revealed = useCellScanStepLit(revealAt);
  return (
    <div {...attributes} style={{ ...style, ...revealInk(revealed) }}>
      {children}
    </div>
  );
}

/** The generic facet row, on the deep-enrichment step. */
function CellScanFacetRow({ facet, accent, revealAt }: {
  facet: SemanticFacet;
  accent: string;
  revealAt: number;
}) {
  const revealed = useCellScanStepLit(revealAt);
  return <FacetEvidenceRow facet={facet} accent={accent} style={revealInk(revealed)} />;
}

/** The walk's own progress, and only while there is a walk. One span of text
 *  is the only thing in the card that has anything new to say every 80ms.
 *
 *  It used to print `LOCKED · A-LATTICE 6/6` in nominal green directly under
 *  the live flag: UI telemetry in the colour of a chain fact, and — once the
 *  walk it reported on was over — permanent decoration in the card's most
 *  valuable corner. The lit facts are that readout. So it says `SCANNING nn%`
 *  in instrument grey and retires on the lock, and the lattice count lives on
 *  as an attribute for anything that needs to watch the walk. */
function CellScanStatusReadout({ landmarks }: { landmarks: number }) {
  const frame = useCellScanFrame();
  return (
    <span
      data-cell-identity-scan-status="true"
      data-cell-scan-lattice={`${Math.min(frame.lit, landmarks)}/${landmarks}`}
      data-cell-scan-classified={frame.classified ? 'true' : 'false'}
      style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.6, whiteSpace: 'nowrap' }}
    >
      {frame.classified ? '' : `SCANNING ${frame.pct}%`}
    </span>
  );
}

/** The sweep itself — the one piece of the reveal that genuinely wants all
 *  12.5 frames a second. It writes its position and the plate's scan state
 *  straight to the DOM (the PULSE hero's idiom), because the alternative is
 *  re-rendering the plate that owns those attributes 30 times a click. React
 *  never re-renders these two nodes, so it never fights the writer for them. */
function CellScanSweep({ plateRef, reduced }: {
  plateRef: { current: HTMLElement | null };
  reduced: boolean;
}) {
  const clock = useCellScanClock();
  const beamRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const write = () => {
      const { pct, classified } = clock.frame;
      const plate = plateRef.current;
      if (plate) {
        plate.dataset.cellularScanState = classified ? 'locked' : 'scanning';
        plate.dataset.cellularScanProgress = String(pct);
      }
      const beam = beamRef.current;
      if (beam) {
        beam.style.transform = `translate3d(${pct}%,0,0)`;
        beam.style.opacity = classified ? '0.18' : '0.7';
        if (classified) beam.style.willChange = '';
      }
    };
    write();
    return clock.subscribe(write);
  }, [clock, plateRef]);
  return (
    <span
      ref={beamRef}
      aria-hidden="true"
      data-cellular-scan-beam
      style={{ position: 'absolute', zIndex: 2, left: 0, top: 0, bottom: 0, width: '100%', transform: 'translate3d(0%,0,0)', opacity: 0.7, transition: reduced ? undefined : 'transform 80ms linear, opacity 220ms ease', pointerEvents: 'none', willChange: reduced ? undefined : 'transform, opacity' }}
    >
      {/* The beam is the plate's own instrument light sweeping the specimen,
          so it is drawn in the plate's colour rather than a fixed cyan. */}
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: `linear-gradient(180deg,transparent,${CELL_CARD_ACCENT},transparent)`, boxShadow: `0 0 12px ${CELL_CARD_ACCENT}` }} />
    </span>
  );
}

/** The byte budget joins on the enrichment-context step. */
function CellScanByteBudget({ capacityShannons, knowledge, dataTruncated, revealAt }: {
  capacityShannons: number;
  knowledge: CellSemanticRecord['common_knowledge'] | null;
  dataTruncated: boolean;
  revealAt: number;
}) {
  const revealed = useCellScanStepLit(revealAt);
  return (
    <CellByteBudget
      capacityShannons={capacityShannons}
      knowledge={knowledge}
      dataTruncated={dataTruncated}
      reveal={revealed ? 1 : 0}
    />
  );
}

type CellScanContentMemoryProps = {
  dataHex: string;
  source?: EnrichmentSourceStatus;
  phase?: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
  pending: boolean;
  /** Which decoded segment the reader is standing on, and how to move it.
   *  Passed straight through: the rows are the window's, the LINK between a
   *  row and the bytes under the square is the card's. */
  focusedSegment: number | null;
  onSegmentFocus: (index: number) => void;
};

/** Content memory decodes THROUGH the walk rather than at a step of it, so it
 *  is one of the two leaves that ride the clock the whole way down. */
function CellScanContentMemory(props: CellScanContentMemoryProps) {
  const progress = useCellScanMemoryProgress();
  return (
    <CellContentMemory
      {...props}
      reveal={clampUnit(progress / CONTENT_DECODED_AT)}
    />
  );
}

/**
 * CKBYTES' plate, and the one thing about it that waits: its ink.
 *
 * The section is mounted for every Cell that holds bytes, from the first frame,
 * at the height the analysis plate beside it leaves — so the reveal has nothing
 * to grow. It lights at `CONTENT_DECODED_AT`, the same instant the DATA cluster
 * finishes decoding, because the segment rows up there NAME these bytes: a dump
 * lit before the line that says what its bytes mean would be read as noise.
 *
 * The subscription lives in this leaf rather than in the card body for the
 * reason every other leaf's does — the body renders once per selection, and a
 * clock read from inside it would drag the whole dossier through the walk's
 * 12.5 ticks a second. The reader arrives as `children`, built by that body and
 * therefore the same element object across a tick, so a tick re-paints this
 * section's ink and React bails out of the dump beneath it on identity.
 */
function CellScanReaderPlate({ beside, children }: {
  /** The reader is a column beside the plate (wide) rather than a row under
   *  the card (narrow) — see CARD_BESIDE_HOLE_PX. */
  beside: boolean;
  children: ReactNode;
}) {
  const revealed = useCellScanSelector(
    (frame) => frame.memoryProgress >= CONTENT_DECODED_AT,
  );
  return (
    <section
      aria-label="CKBytes reader"
      data-cell-detail-module="reader"
      data-cell-inspection-satellite="reader"
      data-cell-detail-size="content"
      data-cell-data-reader-placement={beside ? 'beside' : 'under'}
      data-cell-data-reader-reveal-state={revealed ? 'resolved' : 'scanning'}
      {...revealStageAttributes(revealed)}
      style={{
        ...satelliteBase,
        gridArea: 'reader',
        // "As tall as the plate", exactly. The dump's height is a whole number
        // of 13.5 px rows and the plate's is not, so the section takes the
        // grid row's full height and its bottom padding absorbs the pixels
        // that do not divide. `minHeight: 0` is what lets it: a grid item's
        // default `min-height: auto` refuses to be shorter than its content,
        // and the stretch would turn into a push.
        //
        // Lying under the card there is no plate to be as tall as: the row is
        // its own six rows and the card's height is what it costs.
        alignSelf: beside ? 'stretch' : 'start',
        minHeight: 0,
        overflow: 'hidden',
        padding: '8px 10px 10px 12px',
        ...spatialPlate(CYAN),
        ...revealStageStyle(revealed),
      }}
    >
      {children}
    </section>
  );
}

/** ORIGIN: the lens ramps with the walk, the block around it resolves at 76%. */
function CellScanCausalBlock({ lens, navigation, transaction, consumed, attributes }: {
  lens: CellCausalLens;
  navigation: CellCausalNavigationReadout | null;
  transaction: TransactionSemanticRecord | null;
  consumed: CellSemanticRecord['consumed'] | null;
  attributes: Record<string, string | undefined>;
}) {
  const progress = useCellScanMemoryProgress();
  const revealed = progress >= CAUSAL_REVEALED_AT;
  return (
    <div
      data-consensus-memory-reveal="causal"
      data-consensus-memory-reveal-state={revealed ? 'resolved' : 'scanning'}
      {...attributes}
      {...revealStageAttributes(revealed)}
      // Mounted at full height from the first frame: the walk turns
      // its ink up, it never pushes the footer down.
      style={{ display: 'block', ...revealStageStyle(revealed) }}
    >
      <CellCausalLensReadout
        lens={lens}
        reveal={progress}
        navigation={navigation}
        transaction={transaction}
        consumed={consumed}
        compact
        summary
      />
    </div>
  );
}

/** The MEMORY TRACE affordance arms at 90% of the walk and turns clickable
 *  when the lattice locks — two booleans, and nothing that ticks. */
function CellScanTraceBlock({
  observed,
  onTraceWrite,
  traceSource,
  traceSelected,
  traceStage,
  traceStateReadout,
  identityProofComplete,
}: {
  observed: CellWriteEvidence;
  onTraceWrite?: (linkSeq: number) => void;
  traceSource: ConsensusMemoryTraceSource;
  traceSelected: boolean;
  traceStage: string | undefined;
  traceStateReadout: string;
  identityProofComplete: boolean;
}) {
  const revealed = useCellScanSelector(
    (frame) => frame.memoryProgress >= TRACE_REVEALED_AT,
  );
  const classified = useCellScanClassified();
  const recallEnabled = classified && identityProofComplete;
  return (
    <div
      // The rule over this affordance was cyan at 0.09 — below the alpha this
      // file's own zone-break comment calls no rule at all, and in the
      // consensus plane's colour inside a footer that is violet. It is the
      // footer's ink at the house rule rung now, and it reads at very nearly
      // the weight it did: violet carries about half the light cyan does.
      data-consensus-memory-reveal="trace"
      data-consensus-memory-reveal-state={revealed ? 'resolved' : 'scanning'}
      {...revealStageAttributes(revealed)}
      style={{ display: 'block', marginTop: 4, paddingTop: 2, borderTop: `1px solid ${rgba(VIOLET, 0.16)}`, ...revealStageStyle(revealed) }}
    >
      {onTraceWrite ? (
        <button
          type="button"
          aria-label={traceSelected ? 'exit causal recall' : 'recall causal path'}
          data-write-observed="true"
          data-trace-available="true"
          data-trace-source={traceSource}
          data-trace-selected={traceSelected ? 'true' : 'false'}
          data-trace-state={traceSelected ? 'active' : 'ready'}
          data-trace-stage={traceSelected ? traceStage ?? 'planning' : 'ready'}
          title={observed.txHash}
          onClick={() => onTraceWrite(observed.seq)}
          disabled={!recallEnabled}
          style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', gap: '2px 8px', width: '100%', margin: 0, padding: '3px 2px', border: 0, background: traceSelected ? `${VIOLET}12` : 'transparent', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: traceSelected ? HUD_COLORS.memoryInk : ORANGE, textShadow: `0 0 6px ${traceSelected ? VIOLET : ORANGE}55`, whiteSpace: 'nowrap', cursor: recallEnabled ? 'pointer' : 'default', textAlign: 'left', opacity: recallEnabled ? 1 : 0.62 }}
        >
          <span>MEMORY TRACE</span>
          {/* The shape of the write and how far the recall has got — and NOT
              the block it landed in. That block is the COMMIT fact in the
              register above and ORIGIN TX's own subject; a dossier that
              printed it here as well said one number three times in six
              rows. */}
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
            {observed.inputCount}→{observed.outputCount} · {traceStateReadout}
          </span>
          <PlateReadoutCaption style={{ gridColumn: '1 / -1', whiteSpace: 'normal' }}>
            {recallEnabled ? TRACE_CAPTION_RECALL : TRACE_CAPTION_UNARMED}
          </PlateReadoutCaption>
        </button>
      ) : (
        <div
          data-write-observed="true"
          title={observed.txHash}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: ORANGE, textShadow: `0 0 6px ${ORANGE}55`, whiteSpace: 'nowrap' }}
        >
          <span>MEMORY TRACE</span>
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
            {observed.inputCount}→{observed.outputCount}
          </span>
          <PlateReadoutCaption style={{ flexBasis: '100%', whiteSpace: 'normal' }}>
            {TRACE_CAPTION}
          </PlateReadoutCaption>
        </div>
      )}
    </div>
  );
}

function CellDetailPanel({
  cell,
  recentLinks = EMPTY_RECENT_LINKS,
  routeCellById,
  causalLens = null,
  causalNavigation = null,
  tracedWriteSeq = null,
  traceSource = 'none',
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
  traceEvidencePreviewSourceId = null,
  onTraceEvidenceFocusChange,
  traceRouteHopFocus = null,
  onTraceRouteHopFocusChange,
  traceRouteHopLock = null,
  onTraceRouteHopLockChange,
  identityProofBinding = null,
  onTraceWrite,
  onIdentityProofRead,
  onScanInteractionChange,
  semanticSource,
  semanticPhase,
  semanticRecord,
  semanticMessage,
  semanticTransactionPhase,
  semanticTransactionRecord,
  semanticTransactionMessage,
  onInspectionFieldChange,
  layoutSide = 'left',
  docked = false,
  portraitStandalone = false,
  onClose,
  style,
}: CellDetailPanelProps) {
  const reduced = useReducedMotion();
  const live = cell.death_at_ms === null;
  const semanticValidation = useMemo(
    () => validateCellSemanticRecordForMorphology({
      cell,
      record: semanticRecord,
      source: semanticSource,
      phase: semanticPhase,
    }),
    [cell, semanticPhase, semanticRecord, semanticSource],
  );
  const semanticProofUnavailable = semanticValidation.status === 'inactive'
    && semanticValidation.message !== null;
  const semanticIdentityMismatch = semanticValidation.status === 'mismatch';
  const presentedSemanticPhase = semanticIdentityMismatch
    ? 'error'
    : semanticProofUnavailable ? 'waiting' : semanticPhase;
  const presentedSemanticRecord = semanticIdentityMismatch || semanticProofUnavailable
    ? null
    : semanticRecord;
  const presentedSemanticMessage = semanticValidation.message ?? semanticMessage;
  // The origin-transaction record is looked up by tx hash and may still be the
  // answer to the PREVIOUS selection. A fee printed under the wrong Cell is
  // not a slower fact, it is a false one — so it counts only when the record
  // names this Cell's own creating transaction.
  const originTransaction = useMemo(() => {
    if (!semanticTransactionRecord) return null;
    return semanticTransactionRecord.tx_hash.toLowerCase()
      === cell.out_point.tx_hash.toLowerCase()
      ? semanticTransactionRecord
      : null;
  }, [cell.out_point.tx_hash, semanticTransactionRecord]);
  const enhancedDetail = Boolean(semanticSource && semanticPhase);
  // How long it has stood, which nothing in the register says. Composition
  // backfill emits born_at_ms 0 for records born before the retained window —
  // an epoch-relative age would read as decades, and the birth block the
  // masthead used to fall back to is the COMMIT fact three rows below. Inside
  // one plate that fallback was the same number printed twice, so the flag
  // now stands alone for those Cells.
  const lifetime = cell.born_at_ms > 0
    ? `AGE ${formatAge(cell.born_at_ms, Date.now())}`
    : '';
  const order = CONSENSUS_BRAID_FIELDS;
  // The walk's start, not its state: the clock owns the walking, and the card
  // only has to know which instant this selection began at. Reading the
  // performance clock here is the same thing a `useState` initialiser did —
  // one epoch per Cell, taken the moment that Cell became the subject.
  const scanEpochRef = useRef<{
    cellId: number;
    reduced: boolean;
    epochMs: number;
  } | null>(null);
  const scanClockRef = useRef<ReturnType<typeof createCellScanClock> | null>(
    null,
  );
  if (scanClockRef.current === null) {
    scanClockRef.current = createCellScanClock();
  }
  const scanClock = scanClockRef.current;
  if (
    scanEpochRef.current === null
    || scanEpochRef.current.cellId !== cell.id
    || scanEpochRef.current.reduced !== reduced
  ) {
    scanEpochRef.current = { cellId: cell.id, reduced, epochMs: nowPerf() };
    // Primed here, walked from the effect below: this render is what carries
    // the first frame down to the leaves, so a new subject's card is painted
    // scanning from zero instead of wearing the last one's finished lattice
    // until the first tick.
    scanClock.prime(scanEpochRef.current.epochMs, order.length, reduced);
  }
  const scanEpochMs = scanEpochRef.current.epochMs;
  const analysisPlateRef = useRef<HTMLElement | null>(null);
  const [selectedFieldState, setSelectedFieldState] = useState<{
    cellId: number;
    field: CellInspectionFacet | null;
  }>(() => ({ cellId: cell.id, field: null }));
  const selectedField = selectedFieldState.cellId === cell.id
    ? selectedFieldState.field
    : null;

  // ——— CKBYTES · SCAN·03 —————————————————————————————————————————————————
  //
  // The reader is a ZONE of this card now, not a satellite that opens: the
  // user's direction of 2026-09-05 was 「hex reader 应该总是展示」, so there is
  // no open/closed state left to keep. What IS kept is where the reader is
  // POINTING — the decoded segment a row of the DATA cluster sent it to — and
  // that is a click, exactly like the selected inspection facet one state
  // above, and never the walk.
  //
  // Three fields, and each earns its place:
  //
  //   `cellId`, for the reason the facet selection carries one. A card handed
  //   a new subject is pointing at nothing by construction, with no effect to
  //   reset and therefore no frame in which the old Cell's segment is pressed
  //   over the new Cell's bytes.
  //
  //   `index`, into the presented record's own segment list — the same list
  //   the DATA cluster draws its rows from and the reader colours its bytes
  //   by, so the two cannot mean different segments by the same number.
  //
  //   `nonce`, because this is a GESTURE and not a value. Clicking the same
  //   row twice has to scroll back to it twice; an effect keyed on the range
  //   would fire once and never again (§4's trap).
  const [segmentFocus, setSegmentFocus] = useState<{
    cellId: number;
    index: number;
    nonce: number;
  } | null>(null);
  const focusedSegment = segmentFocus?.cellId === cell.id
    ? segmentFocus.index
    : null;
  const focusSegment = useCallback((index: number) => {
    setSegmentFocus((current) => ({
      cellId: cell.id,
      index,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }, [cell.id]);
  // The reader's own gesture outranks the row's: a byte click or a key move
  // down there means the reader is no longer standing where the DATA cluster
  // put it, and the row unpresses.
  const releaseSegmentFocus = useCallback((segment: number | null) => {
    if (segment === null) setSegmentFocus(null);
  }, []);
  // The prefix the browser is already holding, as the reader wants it.
  //
  // MEMOISED, and the memo is load-bearing rather than tidy: `Uint8Array.from`
  // returns a new array on every call, the hook takes `held` as an effect
  // dependency, and an un-memoised conversion would therefore hand it a new
  // identity on every render of this card — which the scan clock ticks 12.5
  // times a second. The request would be aborted and re-issued on each of
  // them, for as long as the card was open — which is now every card with a
  // byte in it.
  const readerHeldPrefix = useMemo(
    () => Uint8Array.from(
      deriveCellContentMemory(cell.data_hex, presentedSemanticRecord?.content)
        .bytes,
    ),
    [cell.data_hex, presentedSemanticRecord?.content],
  );
  // Whether this card has a reader at all, and it is the CHAIN's count that
  // decides — never `data_hex !== '0x'` (§4's first trap). A clipped prefix is
  // still bytes, and an invalid prefix over a positive `data_bytes` is a
  // reader whose held run is empty and whose fetch fills it. A Cell that holds
  // nothing gets NO plate (R2-2): the DATA fact above already reads `Empty`,
  // and a 408 px window saying so a second time is the card restating an
  // absence in a frame.
  const hasBytes = cell.data_bytes > 0;
  const outputData = useCellOutputData({
    outPoint: cell.out_point,
    // The reader is always mounted, so this gate is no longer "is it open" but
    // "does the Cell hold anything to read". The hook's own comparison
    // (`held.length < totalBytes`) is what still keeps ten thousand of the
    // staged Cells off the network entirely.
    enabled: hasBytes,
    held: readerHeldPrefix,
    // `data_bytes` is the chain's own count, and `data_hex` is a window onto
    // it: every row the reader draws is derived from THIS number.
    totalBytes: cell.data_bytes,
  });
  // How tall the reader is, which is the one thing about this zone that has to
  // be MEASURED.
  //
  // The user's ruling of 2026-09-05: CKBYTES stands under the 280 px CELL SCAN
  // square and its bottom is the analysis plate's bottom. The plate's height is
  // the record it received — a full spore dossier's is ~910 px and a bare
  // CKB-only card's is a third of that — so the rows are the plate's remainder
  // after the square, the seam over the reader, and the reader's own chrome,
  // and never a constant.
  //
  // That measurement is a second `useState` in this body. It is admitted for
  // the same reason `segmentFocus` is: it is moved by the browser reporting a
  // layout, never by the scan clock's tick, so the body still renders once per
  // selection plus once per genuine change of the plate's height.
  // `useCanvasClientRect` is the precedent — a ResizeObserver plus a window
  // `resize`, cached outside the frame loop — and the rounding guard is what
  // keeps a sub-pixel reflow from re-rendering the card. In jsdom, where
  // nothing is laid out and the observer stub never fires, this stays 0 and
  // the row count falls back to its declared number.
  const [plateHeightPx, setPlateHeightPx] = useState(0);
  useEffect(() => {
    const plate = analysisPlateRef.current;
    if (!plate) return undefined;
    const measure = () => {
      const height = Math.round(plate.getBoundingClientRect().height);
      setPlateHeightPx((previous) => (previous === height ? previous : height));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    observer?.observe(plate);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [cell.id]);
  // `PORTRAIT_COLUMN_PX + CARD_SEAM_PX` is handed IN rather than restated in
  // the derive: the square and the seam over the reader are the card's own
  // geometry, and a pure derive that spelled them out would be a second place
  // they are written down.
  // In a hole too small for the wide card the reader is a row under the card
  // rather than a column beside the plate, so it has no plate remainder to
  // fill and takes the floor: six rows, 96 bytes, enough for a molecule header
  // and the start of what follows it. See CARD_BESIDE_HOLE_PX — the measure is
  // decided by the stage the HUD leaves, not by the window's own width.
  const holeWidth = useHudHoleWidth();
  const readerBeside = hasBytes && holeWidth >= CARD_BESIDE_HOLE_PX;
  const cardWidth = cellCardWidth(holeWidth, readerBeside);
  const readerRows = readerBeside
    ? readerRowsUnderScan(
      plateHeightPx,
      PORTRAIT_COLUMN_PX + CARD_SEAM_PX,
      READER_CHROME_PX,
      READER_ROW_HEIGHT_PX,
    )
    : READER_MIN_VISIBLE_ROWS;
  // The record's own segments, and only a validated record's: the reader
  // colours bytes by them and names the one under the pointer, so a record
  // this card has already refused to present may not label a byte in it.
  const readerSegments = presentedSemanticRecord?.content?.deterministic
    ?.segments ?? EMPTY_CONTENT_SEGMENTS;
  // Where a click on a segment row sends the reader. Read from the SAME list
  // the rows are drawn from, so a stale index — a record that arrived while a
  // row was pressed — points at nothing rather than at the wrong bytes.
  const focusedSegmentRange = focusedSegment === null
    ? null
    : readerSegments[focusedSegment] ?? null;
  const readerFocus = focusedSegmentRange === null || segmentFocus === null
    ? null
    : {
      start: focusedSegmentRange.start_byte,
      end: focusedSegmentRange.end_byte,
      segment: focusedSegment,
      nonce: segmentFocus.nonce,
    };

  const identity = useMemo(
    () => deriveCellConsensusIdentity(cell, recentLinks),
    [cell, recentLinks],
  );
  const traceSelected = identity.observedWrite?.seq === tracedWriteSeq;
  const showTracePlate = Boolean(traceSelected && traceReadout);
  const selectedIdentityProofBinding = identityProofBinding?.cellId === cell.id
    ? identityProofBinding
    : null;
  const identityProofComplete = cellIdentityProofBindingComplete(
    selectedIdentityProofBinding,
  );
  const identityProofCount =
    selectedIdentityProofBinding?.resolvedKinds.length ?? 0;
  const handlePortraitIdentityProofRead = useCallback((
    kind: CellIdentityProofKind,
  ) => {
    onIdentityProofRead?.(kind, cell.id, reduced);
  }, [cell.id, onIdentityProofRead, reduced]);
  const inspectedCellById = useMemo<CellById>(() => {
    if (routeCellById?.get(cell.id) === cell) return routeCellById;
    // Overlay, not clone: display residents miss the canonical map (or hold
    // a stale record there), and cloning ~12K entries on every churned block
    // while the panel is open was the panel's dominant render cost.
    return {
      get: (id) => (id === cell.id ? cell : routeCellById?.get(id)),
    };
  }, [cell, routeCellById]);
  const resolvedCausalLens = useMemo(
    () => causalLens ?? deriveCellCausalLens(
      cell,
      recentLinks,
      inspectedCellById,
    ),
    [causalLens, cell, inspectedCellById, recentLinks],
  );
  const agreementTarget = useMemo(
    () => consensusBraidAgreementTarget(cell),
    [cell],
  );

  useEffect(() => {
    onInspectionFieldChange?.(selectedField);
  }, [onInspectionFieldChange, selectedField]);

  // Enriched semantics join the same reveal timeline as the six identity
  // facts — two extra steps after the lattice locks, so nothing deep is lit
  // while something shallow still reads as undiscovered.
  const revealSteps = order.length + (enhancedDetail ? 2 : 0);
  // Where the identity facts end and enrichment begins, in walk steps. Every
  // gate in the card is one of these numbers, so a stage can never disagree
  // with the fact above it about which step it belongs to.
  const semanticsRevealAt = (stage: number) => order.length + stage;

  // Start the walk when the subject changes (the epoch is what says it did,
  // reduced motion included); move only its END when late enrichment adds its
  // two steps. Splitting those is what stops a record arriving mid-walk from
  // resetting the epoch and replaying a lattice the reader already watched
  // light.
  useEffect(() => {
    scanClock.run();
    return () => scanClock.stop();
  }, [scanClock, scanEpochMs]);
  useEffect(() => {
    scanClock.setSteps(revealSteps);
  }, [revealSteps, scanClock]);

  // Four of the six print their reading in their own frame colour, so they say
  // it once, through `cellScanFactAccent`. CAPACITY and COMMIT are the two that
  // do not: bytes and a block height are house facts, and body ink is what a
  // house fact reads in — see the note on that function.
  const factAccent = (field: CellInspectionFacet): string => (
    cellScanFactAccent(cell, field, presentedSemanticRecord)
  );
  const DECODE: Record<CellInspectionFacet, RowDecode> = {
    capacity: { label: 'CAPACITY', value: formatCkb(cell.capacity) },
    asset: {
      label: 'ASSET',
      value: formatScriptIdentity(
        formatAssetKind(cell.asset_kind),
        presentedSemanticRecord?.type_script,
      ),
      color: factAccent('asset'),
    },
    lock: {
      label: 'LOCK',
      value: formatScriptIdentity(
        formatLockKind(cell.lock_kind),
        presentedSemanticRecord?.lock_script,
      ),
      color: factAccent('lock'),
    },
    // Content, not condition: what a Cell carries is knowledge, and knowledge
    // is cyan here — the same cyan the DATA byte segment and the open-DATA
    // card frame wear. It used to be nominal green, which said "healthy"
    // about a byte count that cannot be healthy or otherwise.
    data: {
      label: 'DATA',
      value: formatCellData(cell.data_bytes),
      color: factAccent('data'),
    },
    // WHERE, not STATE — the user's D-6 ruling of 2026-09-05, and the fact
    // finally wears the name of what it does. Pressing it runs the OUTPOINT
    // locator read (`activateField` maps this fact to the `address` proof, and
    // MEMORY TRACE arms on WHERE · WHAT · WHEN), so a fact labelled STATE was
    // the only one on the card whose label named its VALUE instead of its
    // subject. Its value is still the state word, and the masthead's lamp no
    // longer says it: two prints of `LIVE` in one column were the last
    // duplication the declutter rounds left open.
    //
    // The one reading on this card that does NOT take its fact's frame colour
    // by way of `factAccent`, because the two answers are on two layers. SPENT
    // is `ember` — the tone the CELL MESH panel counts deaths in and the tone
    // the galaxy withers a consumed body toward, so the three surfaces that
    // name this event finally name it once. It used to be `caution`, which
    // said an ordinary block of spent outputs was a degraded state.
    state: {
      label: 'WHERE',
      value: live ? 'LIVE' : 'SPENT',
      color: live ? HUD_COLORS.nominal : HUD_COLORS.ember,
    },
    born: { label: 'COMMIT', value: formatBlockRef(cell.birth_block) },
  };
  // One handler for all six facts, carried by identity: the facts are memoized
  // and no longer take a per-frame prop, so this callback is the ONLY thing
  // that can tell them the reduced-motion answer they report changed.
  const activateField = useCallback((field: CellInspectionFacet) => {
    // Read, not subscribe: a handler that fires on a click already knows the
    // walk is over (the fact it fired from is disabled until then), and the
    // card has no business re-rendering to learn it.
    if (!scanClock.frame.classified) return;
    setSelectedFieldState((current) => ({
      cellId: cell.id,
      field: current.cellId === cell.id && current.field === field ? null : field,
    }));
    const proofKind: CellIdentityProofKind | null = field === 'state'
      ? 'address'
      : field === 'data'
        ? 'content'
        : field === 'born'
          ? 'anchor'
          : null;
    if (proofKind) onIdentityProofRead?.(proofKind, cell.id, reduced);
  }, [cell.id, onIdentityProofRead, reduced, scanClock]);

  // ——— Consensus-memory reveal math, absorbed from the old plate ——————
  // The memory pieces (content, causal lens, trace row) join the probe walk
  // late: content decodes through the walk, the causal lens resolves at 76%,
  // the trace affordance arms at 90%. All three are already mounted at their
  // final size — passing these gates only turns their ink up, and each one
  // watches the clock from inside its own block (above) rather than from here.
  const observed = identity.observedWrite;
  // WHERE / WHAT / WHEN read-marks in proof order — the same ◆/◇ the scan
  // facts wear, so the unlock is legible instead of an unexplained ritual.
  const proofGlyphs = (['address', 'content', 'anchor'] as const)
    .map((kind) => (
      selectedIdentityProofBinding?.resolvedKinds.includes(kind) ? '◆' : '◇'
    ))
    .join('');
  const traceStateReadout = !traceSelected
    ? !identityProofComplete
      ? `VERIFY ${proofGlyphs} ${identityProofCount}/3`
      : `${traceSource === 'witness' ? 'WITNESS' : traceSource === 'input' ? 'CAUSAL' : 'TRACE'} ${selectedIdentityProofBinding?.phase === 'retained' ? 'RETAINED' : 'READY'}`
    : traceReadout?.stage === 'converging'
      ? `${traceReadout.arrivedSourceCount}/${traceReadout.sourceCount} ARRIVED`
      : traceReadout?.stage === 'locked'
        ? `${traceReadout.resolvedSourceCount}/${traceReadout.sourceCount} VERIFIED`
        : (traceReadout?.stage ?? 'PLANNING').toUpperCase();

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';
  // The specimen column always sits on the edge nearest the inspected Cell —
  // mirroring for a right or vertical fan swaps the two columns, never any
  // per-satellite coordinate math. The plate can no longer paint behind the
  // transparent scan square (the braid lives there): they are siblings now,
  // not one plate notched around the other.
  const portraitFirst = verticalLayout || layoutSide === 'right';
  // The card, in one grid, and which of two grids depends on ONE fact: whether
  // this Cell holds any bytes.
  //
  // Without them it is what it has always been — two columns, one row, the
  // analysis plate beside the specimen square, at whatever measure the ladder
  // gave the card (`cellCardWidth`): the square and the seam are fixed and the
  // plate is the `1fr`, so a compact card is a narrower register and the same
  // specimen.
  //
  // With them the square gets a companion under it. CKBYTES is 408 px wide and
  // the square is 280, so the reader spans the square's column AND a third,
  // narrower track — the notch — that reaches 120 px past it toward the Cell.
  // The analysis plate spans both rows, which is what makes the reader's
  // bottom the plate's bottom; the notch's own cell in row 1 is a `.`, so
  // nothing paints up there and the card's silhouette is the L the reader
  // makes with the square.
  //
  // Mirrored, the whole thing reflects: the specimen square keeps the edge
  // nearest the Cell it is about, the notch stays on the far side of it, and
  // the plate moves to the other end. That is the rule that already mirrors
  // these columns, applied to three tracks instead of two.
  //
  // …and narrow, the third grid: the two columns of the bare card with the
  // reader lying under both of them, at the card's own narrow measure — 728,
  // or the compact width the hole leaves it under CARD_NARROW_HOLE_PX.
  const cardColumns = readerBeside
    ? (portraitFirst
      ? `${READER_NOTCH_PX}px ${PORTRAIT_COLUMN_PX}px minmax(0, 1fr)`
      : `minmax(0, 1fr) ${PORTRAIT_COLUMN_PX}px ${READER_NOTCH_PX}px`)
    : (portraitFirst
      ? `${PORTRAIT_COLUMN_PX}px minmax(0, 1fr)`
      : `minmax(0, 1fr) ${PORTRAIT_COLUMN_PX}px`);
  // Row 1 is the square, exactly; row 2 is everything the plate has left, and
  // the reader takes it. Declared only when there IS a reader — a two-column
  // card has one implicit row and stating it would fix the plate's height to
  // the square's.
  // A docked card is capped at the band's height (below), so ONE of its rows
  // has to be the one that gives — and it is always the first, the row the
  // analysis plate lives in. Undocked and narrow the rows stay implicit: they
  // are what their content is, and the card grows downward as it always has.
  const cardRows = readerBeside
    ? `${PORTRAIT_COLUMN_PX}px minmax(0, 1fr)${showTracePlate ? ' auto' : ''}`
    : docked
      ? `minmax(0, 1fr)${hasBytes ? ' auto' : ''}${showTracePlate ? ' auto' : ''}`
      : undefined;
  // Growth is strictly downward: an armed MEMORY TRACE appends a full-width
  // row under everything, and it spans whatever the card is wide — three
  // tracks with a reader, two without. The row exists only while the trace is
  // armed; an always-there empty grid row trails an 8px phantom gap.
  const cardAreas = readerBeside
    ? `${portraitFirst
      ? '". scan analysis" "reader reader analysis"'
      : '"analysis scan ." "analysis reader reader"'}${
      showTracePlate ? ' "trace trace trace"' : ''}`
    : `${portraitFirst ? '"scan analysis"' : '"analysis scan"'}${
      hasBytes ? ' "reader reader"' : ''}${
      showTracePlate ? ' "trace trace"' : ''}`;

  // ——— Register cluster evidence ————————————————————————————————————
  const facet = presentedSemanticRecord
    ? primarySemanticFacet(presentedSemanticRecord)
    : null;
  // The DAO position is spelled out row by row below; every other facet keeps
  // the generic one-line summary.
  const daoFacet = presentedSemanticRecord?.facets.find(
    (candidate) => candidate.kind === 'dao',
  ) ?? null;
  const genericFacet = facet && !SPELLED_OUT_FACET_KINDS.has(facet.kind)
    ? facet
    : null;
  // ——— Whose kin, and where the content lives ————————————————————————
  // Two facets the index attaches to a digital object. Read BY KIND and never
  // by namespace: the family is `spore` for one object and `mnft` for the
  // next, both state these same two things, and a read that filtered on the
  // namespace would silently drop a whole family the day it arrived — which is
  // exactly what it did until the index started answering for M-NFT. The
  // namespace is a LABEL here and nothing else.
  const collectionFacet = presentedSemanticRecord?.facets.find(
    (candidate) => candidate.kind === 'collection',
  ) ?? null;
  const compositionFacet = presentedSemanticRecord?.facets.find(
    (candidate) => candidate.kind === 'composition',
  ) ?? null;
  // The role decides which of these rows are TRUE for this Cell, and only the
  // facet ever states it: an object whose decode named no cluster carries no
  // collection facet at all, and that is kinship UNKNOWN — never solitude.
  // Inferring `sole_item` from an absence is the one mistake this block
  // cannot make, because it would print a lie in the panel's own voice.
  const collectionRole = semanticFacetValue(collectionFacet, 'role');
  const collectionName = collectionFacet?.state?.trim() || null;
  const collectionClusterId = semanticFacetValue(
    collectionFacet,
    'collection_id',
  );
  const collectionDescription = semanticFacetValue(
    collectionFacet,
    'description',
  );
  // A cluster Cell says nothing here: its name is already the OBJECT row and
  // its id is already the ARGS row, and repeating either is the clutter this
  // register's redesign killed.
  const collectionStated = collectionRole === 'item'
    || collectionRole === 'sole_item';
  const collectionValue = collectionRole === 'sole_item'
    ? 'SOLE SPORE'
    : collectionName
      ?? (collectionClusterId
        ? midTruncate(collectionClusterId, 12, 9)
        : 'UNRESOLVED');
  // Gold is the house's value emphasis and belongs to a collection that
  // exists. An object that belongs to nothing states that as a fact in
  // instrument grey rather than wearing the ink of a name it does not have,
  // and so does one whose kin the index could not resolve at all.
  const collectionValueColor = collectionRole === 'sole_item'
    || (!collectionName && !collectionClusterId)
    ? HUD_COLORS.dim
    : HUD_COLORS.goldInk;
  // Provenance: the collection's description when the index stated one, and
  // the full cluster id underneath it whenever the id is what the row had to
  // print in place of a name.
  const collectionTitle = [
    collectionDescription,
    collectionName ? null : collectionClusterId,
  ].filter(Boolean).join(' · ') || undefined;
  // The id gets a row of its own once a NAME has taken the row above it. With
  // no name the COLLECTION row is already printing this hex, and a register
  // that says the same string twice in two lines is the clutter this layout
  // exists to prevent.
  const collectionIdRow = collectionRole === 'item' && collectionName
    ? collectionClusterId
    : null;
  // What that id's family CALLS a collection. Spore keys objects by a cluster
  // and M-NFT by a class, and printing either family's word over the other's
  // id would be the register naming a thing that does not exist upstream. A
  // third family arriving is a group this side has no word for yet, and says
  // so. The row keyword stays `cluster-id` — the label is what changed, and
  // the oracles that read the attribute are not part of that change.
  const collectionIdLabel = collectionFacet?.namespace === 'spore'
    ? 'CLUSTER'
    : collectionFacet?.namespace === 'mnft'
      ? 'CLASS'
      : 'COLLECTION ID';
  // Population is a fact about a group, so it belongs to the two roles that
  // HAVE one.
  const collectionKin = collectionRole === 'item'
    || collectionRole === 'cluster';
  const populationReadout = collectionKin
    ? collectionPopulationReadout(collectionFacet)
    : null;
  // The headline is the facet's `state` and is never recomputed here. The
  // index states this object's OWN tier when it measured one and the
  // population's otherwise — a spore item cell has both keys and a cluster
  // Cell, an M-NFT token and an M-NFT class have only the aggregate — and that
  // choice is upstream's to make once rather than this panel's to make twice.
  const compositionHeadline = compositionFacet?.state?.trim() || null;
  const compositionCounts = compositionCountsReadout(compositionFacet);
  const compositionMix = compositionMixReadout(compositionFacet);
  // Only a spore ever carries this: M-NFT publishes no per-item media profile
  // upstream, so there is nothing to have found issues in.
  const itemIssues = semanticFacetValue(compositionFacet, 'item_issues');
  const assetAmount = presentedSemanticRecord
    ? semanticAssetAmountReadout(presentedSemanticRecord)
    : null;
  const assetIdentity = presentedSemanticRecord
    ? semanticAssetIdentityReadout(presentedSemanticRecord)
    : null;
  const assetObject = semanticObjectReadout(presentedSemanticRecord);
  const lockScript = presentedSemanticRecord?.lock_script ?? null;
  const typeScript = presentedSemanticRecord?.type_script ?? null;
  const lockAccent = factAccent('lock');
  const assetAccent = factAccent('asset');
  // A record is on its way: hold the rows it will fill at their final height
  // so the arrival replaces ghosts instead of pushing the card down. When it
  // resolves — record, absence or failure — the reservation drops ONCE.
  const enrichmentPending = Boolean(semanticSource)
    && !presentedSemanticRecord
    && (semanticPhase === 'loading' || semanticPhase === 'waiting');
  // A cluster prints its evidence rail only when it has something to hang on
  // it: an empty rail under a bare fact is the sparseness this layout exists
  // to kill.
  const lockEvidencePresent = Boolean(
    cell.lock_script || presentedSemanticRecord?.address || lockScript
      || enrichmentPending,
  );
  const assetEvidencePresent = Boolean(
    cell.type_script || assetAmount || assetIdentity || assetObject
      || typeScript || daoFacet || collectionFacet || compositionFacet
      || genericFacet || enrichmentPending,
  );
  const knowledge = presentedSemanticRecord?.common_knowledge ?? null;
  const hasKnowledge = Boolean(knowledge && knowledge.total_bytes > 0);
  const dataTruncated = cell.data_hex.endsWith(DATA_HEX_TRUNCATION_MARKER);
  const statusLine = enrichmentStatusMessage(
    presentedSemanticPhase ?? semanticPhase,
    presentedSemanticMessage,
  );
  // The record's PROOF anchor (and CREATED only when it genuinely disagrees
  // with the COMMIT fact) live in the provenance footer with the other
  // record-keeping affordances.
  const createdDiffers = presentedSemanticRecord
    ? presentedSemanticRecord.observed_at_block !== cell.birth_block
    : false;
  // Canonical evidence — what the Cell itself carries — lights with the fact
  // it hangs under, not with the index's timeline.
  const factRevealAt = (field: CellInspectionFacet): number => (
    CKBYTES_REVEAL_ORDER.indexOf(field) + 1
  );
  const scanFact = (field: CellInspectionFacet) => {
    const proofKind = field === 'state'
      ? 'address'
      : field === 'data'
        ? 'content'
        : field === 'born'
          ? 'anchor'
          : null;
    return (
      <CellScanFact
        field={field}
        {...DECODE[field]}
        accent={factAccent(field)}
        revealAt={factRevealAt(field)}
        selected={field === selectedField}
        proof={proofKind
          ? {
            read: selectedIdentityProofBinding?.resolvedKinds
              .includes(proofKind) ?? false,
          }
          : undefined}
        onActivate={activateField}
      />
    );
  };
  const clusterEvidenceStyle: CSSProperties = {
    display: 'grid',
    gap: 3,
    minWidth: 0,
    margin: CLUSTER_EVIDENCE_INDENT,
  };

  // The clock is handed DOWN, never read here: the card below is rendered by
  // this body once per selection, and the leaves inside it subscribe to the
  // walk on their own account. That is the whole fix — a tick can no longer
  // reach this function.
  return (
    <CellScanClockContext.Provider value={scanClock}>
    <div
      data-cell-detail-scan-field="true"
      data-cell-detail-enhanced={enhancedDetail ? 'true' : 'false'}
      data-cell-detail-layout={verticalLayout ? 'vertical' : layoutSide}
      data-cell-detail-readability="large"
      style={{
        position: 'relative',
        display: 'grid',
        // The analysis plate keeps its measure with a reader and without one:
        // it is the `1fr` between fixed tracks, and 856 − 120 − 280 − two
        // seams is the 440 it has always been. The square and the notch are
        // fixed rather than shares of the card, because a dump is a fixed
        // measure — seventy-three monospace characters — and a track that
        // flexed would either clip a row or leave a gutter.
        gridTemplateColumns: cardColumns,
        // Two rows only when the reader is there to take the second one, and
        // the trace row exists only while the armed MEMORY TRACE window is
        // appended — an always-there empty row would trail an 8px phantom gap
        // under the analysis plate.
        gridTemplateRows: cardRows,
        gridTemplateAreas: cardAreas,
        columnGap: CARD_SEAM_PX,
        rowGap: 8,
        alignItems: 'start',
        width: cardWidth,
        // The card never outgrows the window it is drawn in, whichever of the
        // three measures it takes. Under CARD_BESIDE_HOLE_PX the measure steps
        // down and under CARD_NARROW_HOLE_PX it follows the hole itself, so
        // this is the last resort it was meant to be rather than the only
        // narrow rule the card has. It answers one case the ladder cannot: a
        // window narrower than the card's own floor.
        maxWidth: `calc(100vw - ${CARD_EDGE_RESERVE_PX}px)`,
        // …and the same rule on the other axis, but only when the solver says
        // the card is docked. The band is the viewport less the HUD's safe top
        // and the bottom edge — the two numbers the placement solver clamps
        // into — and capping the card AT it is what makes the docked family a
        // fixpoint rather than a flicker. Without it the dossier simply ran off
        // the bottom of a 800px screen with its PROOF anchor below the fold.
        ...(docked
          ? {
            maxHeight: `calc(100vh - ${CARD_DOCK_RESERVE_PX}px)`,
            overflow: 'hidden',
          }
          : null),
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow around the constellation replaces a separate
        // filter surface for every satellite. It follows the silhouette, so
        // the scan square and the plate beside it cast one shadow instead of
        // two stacked ones. The peer cards derive this glow from a live accent;
        // the cell card has no per-fact accent at card level, so it derives it
        // from the dialect's identity instead — the same colour the frame,
        // the beam and the tether are drawn in.
        filter: `drop-shadow(0 8px 16px ${rgba(HUD_COLORS.ground, 0.56)}) drop-shadow(0 0 14px ${rgba(CELL_CARD_ACCENT, 0.06)})`,
        animation: reduced
          ? undefined
          : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
        ...style,
      }}
    >
      <section
        ref={analysisPlateRef}
        aria-label="CKBytes analysis"
        data-cell-detail-module="ckbytes"
        data-cell-inspection-satellite="analysis"
        // data-cellular-scan-state / -progress are written by CellScanSweep
        // below, straight to this node: they change 12.5 times a second and
        // this plate holds the whole dossier.
        data-memory-identity-binding="true"
        data-memory-identity-phase={
          selectedIdentityProofBinding?.phase ?? 'collecting'
        }
        data-memory-identity-count={identityProofCount}
        data-memory-identity-complete={identityProofComplete ? 'true' : 'false'}
        style={{
          ...satelliteBase,
          gridArea: 'analysis',
          // Docked, the plate is the card's one elastic part: it fills the row
          // the cap left it and scrolls inside itself, so the provenance
          // footer at the bottom of the dossier is always reachable. `minHeight
          // 0` is what lets a grid item be shorter than its content at all.
          //
          // ⚠️ The two cases are ONE spread, and they have to be: the shorthand
          // and the longhand cannot both appear in this object. A CSSOM
          // assignment applies in insertion order, so an `overflow` written
          // after an `overflowY` — even an `overflow` React skips as undefined,
          // which it writes as `''` — resets both longhands and the plate goes
          // back to `visible`. jsdom does not model that, so the unit test read
          // `auto` off a browser that was showing `visible`; the live capture
          // is what caught it.
          ...(docked
            ? {
              alignSelf: 'stretch' as const,
              minHeight: 0,
              overflowX: 'hidden' as const,
              overflowY: 'auto' as const,
            }
            : { overflow: 'hidden' as const }),
          // One rectangle, one column: plate header, register clusters, bytes
          // zone, provenance footer — the house plate's own 12px cut corner is
          // the only shape it wears.
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          rowGap: 8,
          alignContent: 'start',
          padding: '9px 12px 10px 14px',
          // The dossier's one frame, and the only place identity is spoken on
          // this card: the rail, the border and the tinted tail. Everything
          // inside keeps its own vocabulary — consensus cyan, memory violet,
          // the value golds — because the plate says WHAT this window is about
          // and the register says what the Cell holds.
          ...spatialPlate(CELL_CARD_ACCENT),
        }}
      >
        <CellScanSweep plateRef={analysisPlateRef} reduced={reduced} />

        {/* The masthead the standalone identity plate used to be. The dossier
          * is ONE window, so the Cell it is about titles it — a second plate
          * above this one only repeated the subject in a taller frame. Two
          * lines: WHO the specimen is, then WHERE it lives and how far the
          * scan has read. The `CLOSE` affordance belongs to the titled plate,
          * as it does in every other dialect — and, as in every other dialect,
          * the title is spoken in the CARD's accent. It said `CELL // #id` in
          * chrome orange for as long as the card was cyan and nobody could see
          * the difference between a frame and a bracket; the rose rebind swept
          * the cyan and left the orange behind, so the one line that names the
          * creature was the only thing on the plate not painted in its blood. */}
        <div data-cell-scan-identity style={{ minWidth: 0, display: 'grid', gap: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 8px', minWidth: 0, paddingRight: 20 }}>
            <span style={{ color: CELL_CARD_ACCENT, fontFamily: HUD_FONTS.display, fontSize: HUD_TYPE.title, fontWeight: 600, letterSpacing: 1.6, textShadow: `0 0 9px ${rgba(CELL_CARD_ACCENT, 0.45)}` }}>
              CELL // #{cell.id}
            </span>
            {/* The house CJK companion, as PEER wears 对端 and NODE wears 节点.
              * 细胞 is in the hand-subset woff2 (fonts/README.md) — deliberate
              * presence, where SightedNodeCard documents a deliberate absence. */}
            <span style={{ ...CJK_BASELINE_LIFT, color: CELL_CARD_ACCENT, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
              细胞
            </span>
            {/* THE LAMP AND THE AGE, AND NOT THE WORD (the user's D-6 ruling
              * of 2026-09-05). The masthead read `● LIVE · AGE 3 D` while the
              * register four rows below read `WHERE · LIVE` in the same green:
              * one card, one column, the same word twice. The lamp is the
              * status — lit or cooled, in the tone — and the register spells
              * it, because the register is where this card states facts.
              *
              * A reading, not a chip: `color` and nothing else, which is the
              * only layer `ember` is allowed on. The lamp itself used to be
              * `caution` when cooled, so the masthead of every consumed Cell
              * opened in the HUD's degradation yellow — a small alarm raised
              * over the most ordinary thing a chain does.
              *
              * ⚠️ The lamp needs a title now: unlabelled, it is a coloured dot
              * and the word that glossed it is gone from this line. */}
            <span title={live ? 'LIVE' : 'SPENT'} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', color: live ? HUD_COLORS.nominal : HUD_COLORS.ember, fontSize: HUD_TYPE.section, letterSpacing: 0.9 }}>
              <StatusLamp color={live ? HUD_COLORS.nominal : HUD_COLORS.ember} lit={live} size={5.5} />
              {lifetime}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 8px', minWidth: 0 }}>
            {/* The outpoint, which is what a viewer can look up anywhere else —
              * the old head of the content hash beside an output index read
              * like an outpoint and was not one. */}
            <span title={cell.out_point.tx_hash} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, letterSpacing: 0.9 }}>
              {formatOutpoint(cell.out_point.tx_hash, cell.out_point.index)}
            </span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
              <CellScanStatusReadout landmarks={order.length} />
              {moduleTag('SCAN·01')}
            </span>
          </div>
        </div>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />

        <div
          data-cell-analysis-register="true"
          style={{ minWidth: 0, display: 'grid', gap: 4, alignContent: 'start' }}
        >
          <div data-cell-cluster="lock" style={{ minWidth: 0 }}>
            {scanFact('lock')}
            {lockEvidencePresent ? (
              <div data-cell-cluster-evidence="lock" style={clusterEvidenceStyle}>
                {/* CODE is the Cell's own account of which script guards it —
                  * it needs no index, so ~98% of clicks (bare Cells) still get
                  * a real row under the LOCK fact. */}
                {cell.lock_script ? (
                  <ClusterRow
                    row="lock-code"
                    accent={lockAccent}
                    label="CODE"
                    value={scriptCodeReadout(cell.lock_script)}
                    title={cell.lock_script.code_hash}
                    badge={scriptStateChip(lockScript)}
                    revealAt={factRevealAt('lock')}
                  />
                ) : null}
                <div
                  data-cell-evidence-slot="lock"
                  style={{ display: 'grid', gap: EVIDENCE_ROW_GAP_PX, minWidth: 0, minHeight: enrichmentPending ? reservedEvidenceHeight(LOCK_ENRICHMENT_ROWS, LOCK_ENRICHMENT_CAPTIONS) : undefined }}
                >
                  {presentedSemanticRecord?.address ? (
                    <ClusterRow
                      row="owner"
                      accent={lockAccent}
                      label="OWNER"
                      value={midTruncate(presentedSemanticRecord.address, 14, 12)}
                      // The address AND where it comes from, on hover. The
                      // sentence was a printed caption under the row (the
                      // user's D-19 ruling moved it): it explains the row's
                      // provenance once, to a reader who wonders, and it is
                      // not a fact about this Cell — every OWNER row on every
                      // card carried the same sixteen words.
                      title={`${presentedSemanticRecord.address}\nADDRESS ENCODED FROM THE LOCK SCRIPT`}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {lockScript ? (
                    <ClusterRow
                      row="lock-script"
                      accent={lockAccent}
                      label="SCRIPT"
                      value={midTruncate(lockScript.script_hash, 12, 9)}
                      title={lockScript.script_hash}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {lockScript ? (
                    <ClusterRow
                      row="lock-args"
                      accent={lockAccent}
                      label="ARGS"
                      value={scriptArgsReadout(lockScript.args)}
                      title={lockScript.args}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {enrichmentPending ? (
                    <GhostRows
                      rows={LOCK_ENRICHMENT_ROWS}
                      captions={LOCK_ENRICHMENT_CAPTIONS}
                      accent={lockAccent}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div data-cell-cluster="type" style={{ minWidth: 0 }}>
            {scanFact('asset')}
            {assetEvidencePresent ? (
              <div data-cell-cluster-evidence="type" style={clusterEvidenceStyle}>
                {/* A plain Cell carries no type script at all, and says so by
                  * having no CODE row — absence is the fact. */}
                {cell.type_script ? (
                  <ClusterRow
                    row="type-code"
                    accent={assetAccent}
                    label="CODE"
                    value={scriptCodeReadout(cell.type_script)}
                    title={cell.type_script.code_hash}
                    badge={scriptStateChip(typeScript)}
                    revealAt={factRevealAt('asset')}
                  />
                ) : null}
                <div
                  data-cell-evidence-slot="type"
                  style={{ display: 'grid', gap: EVIDENCE_ROW_GAP_PX, minWidth: 0, minHeight: enrichmentPending ? reservedEvidenceHeight(ASSET_ENRICHMENT_ROWS) : undefined }}
                >
                  {/* The value rows — how much, of what, where in the DAO,
                    * earning what — read in `goldInk`, the house's
                    * value-emphasis tier. They used to read in caution yellow,
                    * which said "watch out" about somebody's token balance.
                    *
                    * Four rows, one family, and the ink is the whole of the
                    * emphasis. AMOUNT alone used to be lifted to `value` as
                    * well — two rungs over IDENTITY directly beneath it, both
                    * gold, both about the same asset, with nothing anywhere
                    * saying why. The register has ONE type size: the rows step
                    * down to `label`, which is what `PlateReadoutRow`'s own
                    * doc calls the evidence tier, and the single thing in this
                    * stack set at `value` is `CompositionBlock` — which is set
                    * there because it stopped being a row. Ink carries the
                    * emphasis, size carries the register. */}
                  {assetAmount ? (
                    <ClusterRow
                      row="amount"
                      accent={assetAccent}
                      label="AMOUNT"
                      value={assetAmount}
                      valueColor={HUD_COLORS.goldInk}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {assetIdentity ? (
                    <ClusterRow
                      row="identity"
                      accent={assetAccent}
                      label="IDENTITY"
                      value={assetIdentity}
                      valueColor={HUD_COLORS.goldInk}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {/* Whose kin the object is, then the object itself, then
                    * where its content lives — collection facts first, so the
                    * OBJECT row reads as one specimen out of the population
                    * stated above it, and the durability of its bytes sits
                    * under what those bytes are. */}
                  {collectionStated ? (
                    <ClusterRow
                      row="collection"
                      accent={assetAccent}
                      label="COLLECTION"
                      value={collectionValue}
                      valueColor={collectionValueColor}
                      title={collectionTitle}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {collectionIdRow ? (
                    <ClusterRow
                      row="cluster-id"
                      accent={assetAccent}
                      label={collectionIdLabel}
                      value={midTruncate(collectionIdRow, 12, 9)}
                      title={collectionIdRow}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {populationReadout ? (
                    <ClusterRow
                      row="population"
                      accent={assetAccent}
                      label="POPULATION"
                      value={populationReadout}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {assetObject ? (
                    <ClusterRow
                      row="object"
                      accent={assetAccent}
                      label="OBJECT"
                      value={assetObject}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {/* Where the content named one row up physically lives —
                    * what it holds, then where that lives. One block, not the
                    * two rows this used to be: the population's mix and this
                    * object's own tier were the same sentence printed twice,
                    * and the index already decides which of them is the
                    * answer for THIS Cell. */}
                  {compositionHeadline ? (
                    <CompositionBlock
                      tier={compositionHeadline}
                      mix={compositionMix}
                      issues={itemIssues}
                      title={[
                        compositionTierDescription(compositionHeadline),
                        compositionCounts,
                      ].filter(Boolean).join(' ')}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {typeScript ? (
                    <ClusterRow
                      row="type-script"
                      accent={assetAccent}
                      label="SCRIPT"
                      value={midTruncate(typeScript.script_hash, 12, 9)}
                      title={typeScript.script_hash}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {typeScript ? (
                    <ClusterRow
                      row="type-args"
                      accent={assetAccent}
                      label="ARGS"
                      value={scriptArgsReadout(typeScript.args)}
                      title={typeScript.args}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {/* The DAO position, read BY KEY: upstream appends attributes,
                    * so a positional read would print a timestamp under a label
                    * that means compensation. */}
                  {daoFacet?.state ? (
                    <ClusterRow
                      row="dao-position"
                      accent={assetAccent}
                      label="POSITION"
                      value={daoFacet.state.toUpperCase()}
                      valueColor={HUD_COLORS.goldInk}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {daoFacet ? [
                    ['dao-deposited', 'DEPOSITED', 'deposit_block', 'deposit_at_ms'],
                    ['dao-withdraw-request', 'WITHDRAW REQ', 'withdraw_request_block', 'withdraw_request_at_ms'],
                    ['dao-withdrawn', 'WITHDRAWN', 'withdraw_block', 'withdraw_at_ms'],
                  ].map(([row, label, blockKey, atMsKey]) => {
                    const value = daoMomentReadout(
                      daoFacet,
                      blockKey,
                      atMsKey,
                      cell.birth_block,
                    );
                    return value ? (
                      <ClusterRow
                        key={row}
                        row={row}
                        accent={assetAccent}
                        label={label}
                        value={value}
                        revealAt={semanticsRevealAt(1)}
                      />
                    ) : null;
                  }) : null}
                  {semanticFacetValue(daoFacet, 'estimated_apc') ? (
                    <ClusterRow
                      row="dao-apc"
                      accent={assetAccent}
                      label="EST APC"
                      value={semanticFacetValue(daoFacet, 'estimated_apc') ?? ''}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {semanticFacetValue(daoFacet, 'compensation') ? (
                    <ClusterRow
                      row="dao-compensation"
                      accent={assetAccent}
                      label="COMPENSATION"
                      value={semanticFacetValue(daoFacet, 'compensation') ?? ''}
                      valueColor={HUD_COLORS.goldInk}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {genericFacet ? (
                    <CellScanFacetRow
                      facet={genericFacet}
                      accent={assetAccent}
                      revealAt={semanticsRevealAt(2)}
                    />
                  ) : null}
                  {enrichmentPending ? (
                    <GhostRows rows={ASSET_ENRICHMENT_ROWS} accent={assetAccent} />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div
            data-cell-cluster="consensus"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 10px', minWidth: 0 }}
          >
            {scanFact('state')}
            {scanFact('born')}
            {/* When the Cell was written, in a clock a human keeps — and ONLY
              * that. The block is the COMMIT fact one row up; printing it
              * again here made the cluster say the same number twice in the
              * space of two lines. Composition backfill emits born_at_ms 0 for
              * Cells born before the retained window, and an epoch-relative
              * date would be a lie, so those drop the row entirely and let
              * COMMIT stand alone. */}
            {cell.born_at_ms > 0 ? (
              <ClusterRow
                row="born"
                accent={CYAN}
                label="BORN"
                value={formatWallClock(cell.born_at_ms)}
                revealAt={factRevealAt('born')}
                style={{ gridColumn: '1 / -1', margin: CLUSTER_EVIDENCE_INDENT }}
              />
            ) : null}
          </div>

        </div>

        {/* Zone break. The rules between the three ranks were drawn at 0.12
          * and 0.18 alpha — under this background that is no rule at all —
          * while the gap INSIDE the register (6) all but matched the gap
          * BETWEEN ranks (7). Fourteen bands of equal weight read as one
          * undifferentiated column, which is the clutter. Ranks separate
          * wide and visibly; clusters inside a rank sit close.
          *
          * That raise landed on TWO numbers, 0.24 here and 0.32 on the
          * footer below, and nothing ever argued the difference. One rung
          * now — the alpha table in `hudTheme.ts` — and it is the higher of
          * the two, because the failure this comment records is a rule going
          * invisible and the footer's violet is half the luminance of this
          * cyan. */}
        <div
          data-cell-analysis-bytes="true"
          style={{
            minWidth: 0,
            paddingTop: 11,
            borderTop: `1px solid ${rgba(CYAN, 0.32)}`,
            display: 'grid',
            gap: 6,
          }}
        >
          {/* The budget reads as the CAPACITY fact's evidence, under it in
            * the same indent every other cluster's evidence uses — arriving
            * knowledge must never reflow the fact beside it. */}
          <div data-cell-cluster="capacity" style={{ minWidth: 0 }}>
            {scanFact('capacity')}
            <div
              data-cell-evidence-slot="capacity"
              style={{ minWidth: 0, margin: CLUSTER_EVIDENCE_INDENT, minHeight: enrichmentPending ? reservedEvidenceHeight(BYTE_BUDGET_GHOST_ROWS) : undefined }}
            >
              {hasKnowledge ? (
                <CellScanByteBudget
                  capacityShannons={cell.capacity}
                  knowledge={knowledge}
                  dataTruncated={dataTruncated}
                  revealAt={semanticsRevealAt(1)}
                />
              ) : enrichmentPending ? (
                /* The ghosts take the CAPACITY fact's own accent, the way
                 * every other cluster's do. They were railed in chrome
                 * orange, so a stack of orange rails hung under a cyan fact
                 * for as long as the index took to answer — and then the
                 * arriving bar replaced them with something a different
                 * colour, which is the one thing a placeholder must not do. */
                <GhostRows rows={BYTE_BUDGET_GHOST_ROWS} accent={factAccent('capacity')} />
              ) : null}
            </div>
          </div>

          <div data-cell-cluster="data" style={{ minWidth: 0 }}>
            {scanFact('data')}
            {/* The window mounts whole, but its analysis rows are the one
              * part of it that waits on the index — so they take the same
              * pending reservation every other cluster's evidence takes.
              * This is the LAST cluster before the provenance footer: rows
              * that arrive tall here move the footer and the MEMORY TRACE. */}
            <CellScanContentMemory
              dataHex={cell.data_hex}
              source={semanticSource}
              phase={presentedSemanticPhase}
              record={presentedSemanticRecord}
              message={presentedSemanticMessage}
              pending={enrichmentPending}
              focusedSegment={focusedSegment}
              onSegmentFocus={focusSegment}
            />
          </div>
        </div>

        <div
          data-cell-provenance-footer="true"
          style={{ minWidth: 0, paddingTop: 11, borderTop: `1px solid ${rgba(VIOLET, 0.32)}` }}
        >
          {resolvedCausalLens ? (
            <CellScanCausalBlock
              lens={resolvedCausalLens}
              navigation={causalNavigation}
              transaction={originTransaction}
              consumed={presentedSemanticRecord?.consumed ?? null}
              // The origin transaction's own evidence has a second source
              // behind it, on its own clock. Its state is stamped, never
              // reserved: the footer sits below the fold of the reveal, so a
              // fee that arrives late costs the reader nothing.
              attributes={{
                'data-cell-origin-tx-phase': semanticTransactionPhase ?? 'none',
                'data-cell-origin-tx-state': originTransaction
                  ? 'resolved'
                  : semanticTransactionRecord ? 'mismatch' : 'absent',
                'data-cell-origin-tx-note': semanticTransactionMessage ?? undefined,
              }}
            />
          ) : null}
          {observed ? (
            <CellScanTraceBlock
              observed={observed}
              onTraceWrite={onTraceWrite}
              traceSource={traceSource}
              traceSelected={traceSelected}
              traceStage={traceReadout?.stage}
              traceStateReadout={traceStateReadout}
              identityProofComplete={identityProofComplete}
            />
          ) : null}
          {/* Which block the index's answer is true at, and how healthy the
            * index behind it is — one line, because they are one subject.
            * The source strip used to hang off the bottom of the REGISTER,
            * railless and unaligned between the consensus pair and CAPACITY,
            * which is the middle of a column of chain facts stating something
            * about our own record-keeping. It belongs down here with the
            * anchor it qualifies. */}
          {presentedSemanticRecord || (semanticSource && semanticPhase) ? (
            <CellScanStagedBlock
              revealAt={semanticsRevealAt(1)}
              attributes={{
                'data-cell-provenance-proof': presentedSemanticRecord
                  ? 'true'
                  : undefined,
                'data-cell-semantics-phase': semanticPhase
                  ? presentedSemanticPhase ?? semanticPhase
                  : undefined,
                'data-cell-semantics-source': semanticSource?.status,
              }}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 14, rowGap: 2, marginTop: 4, minWidth: 0 }}
            >
              {presentedSemanticRecord ? (
                <EvidenceFact
                  label="PROOF"
                  value={formatBlockRef(presentedSemanticRecord.as_of.block)}
                  title={PROOF_TITLE}
                  color={HUD_COLORS.cyanWire}
                />
              ) : null}
              {createdDiffers && presentedSemanticRecord ? (
                <EvidenceFact
                  label="CREATED"
                  value={formatBlockRef(
                    presentedSemanticRecord.observed_at_block,
                  )}
                />
              ) : null}
              {semanticSource && semanticPhase ? (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ alignSelf: 'center', width: 4, height: 4, borderRadius: '50%', background: enrichmentSourceColor(semanticSource.status), boxShadow: `0 0 6px ${enrichmentSourceColor(semanticSource.status)}` }} />
                  <span style={{ color: enrichmentSourceColor(semanticSource.status), fontSize: HUD_TYPE.micro, letterSpacing: 0.9, whiteSpace: 'nowrap' }}>
                    {semanticSource.status.toUpperCase()}
                  </span>
                  {semanticSource.lag_blocks != null ? (
                    <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
                      · {semanticSource.lag_blocks} BLOCK LAG
                    </span>
                  ) : null}
                </span>
              ) : null}
              {statusLine ? (
                <div title={statusLine} style={{ flexBasis: '100%', minWidth: 0, color: (presentedSemanticPhase ?? semanticPhase) === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: HUD_TYPE.label, lineHeight: 1.45 }}>
                  {statusLine}
                </div>
              ) : null}
            </CellScanStagedBlock>
          ) : null}
        </div>
      </section>

      <section
        aria-label="Interactive Cell scan"
        data-cell-detail-module="specimen"
        data-cell-inspection-satellite="specimen"
        // The one transparent window on this card, and the reason the overlay
        // has to find it from outside: `background: 'transparent'` below is a
        // hole through the whole DOM HUD, so whatever the HUD has under it
        // prints on the specimen. `dimHudPanelsUnder` reads this box.
        data-cell-scan-window="true"
        data-cell-portrait-frame
        style={{
          ...satelliteBase,
          gridArea: 'scan',
          alignSelf: 'start',
          width: PORTRAIT_COLUMN_PX,
          aspectRatio: '1 / 1',
          overflow: 'hidden',
          border: `1px solid ${rgba(HUD_COLORS.orange, 0.24)}`,
          // The braid renders on the MAIN canvas beneath this card
          // (CellPortraitInset), so the directional plate lives in that scene
          // as its backing — a DOM background here would dim the braid. The
          // circular idiom in this viewport still belongs to the content
          // address halo (the one ring that reads as data).
          background: 'transparent',
          // Viewport chrome: the inset breath is the card's identity, the
          // outer one is house orange. The braid inside keeps the consensus
          // cyan it is rendered in — that is content, and it is in the scene.
          boxShadow: `inset 0 0 26px ${rgba(CELL_CARD_ACCENT, 0.08)},0 0 20px ${rgba(HUD_COLORS.orange, 0.06)}`,
        }}
      >
        <div style={{ position: 'absolute', zIndex: 3, left: 12, top: 10, right: 12, display: 'flex', alignItems: 'baseline', gap: 8, pointerEvents: 'none' }}>
          <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.section, fontWeight: 700, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>CELL SCAN</span>
          {/* The axis mark is drawn, not typed: `↔` is in none of the faces
              this repo ships and in none of the upstream faces either, so the
              one affordance telling a reader the square is draggable was set
              in whatever their machine had.
            *
            * The mark is decoration and hidden, which leaves the compact copy
            * saying only ORBIT where it used to say ORBIT and an axis. The
            * title carries the gesture instead, in both layouts and to a
            * reader who cannot see either — the same way the byte budget's
            * hints are worded. */}
          <span data-cell-scan-drag-affordance title="Drag the specimen square to orbit it" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.9, whiteSpace: 'nowrap' }}>
            {verticalLayout ? 'ORBIT' : 'DRAG TO ORBIT'}
            <DragAxisMark />
          </span>
        </div>
        <CellNucleusPortrait
          cell={cell}
          reducedMotion={reduced}
          scanEpochMs={scanEpochMs}
          layoutSide={layoutSide}
          standalone={portraitStandalone}
          // A field can only be selected once the lattice has locked (the
          // facts are disabled until then) and the selection is cleared with
          // the Cell, so a set field IS a classified scan.
          focusField={selectedField}
          traceReadout={traceReadout}
          traceResponseRef={traceResponseRef}
          traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
          semanticRecord={semanticValidation.record}
          identityProofBinding={selectedIdentityProofBinding}
          onIdentityProofRead={onIdentityProofRead
            ? handlePortraitIdentityProofRead
            : undefined}
          onInteractionChange={onScanInteractionChange}
        />
        {/* Ambient specimen sweep — it loops for as long as the panel is open
          * and deliberately outlives the probe walk, so a classified specimen
          * still reads as live instrumentation. It animates transform/opacity
          * only (never `top`), which is what keeps it off the layout path. */}
        <span
          key={cell.id}
          aria-hidden="true"
          data-cell-specimen-scan-light
          style={{ position: 'absolute', zIndex: 2, left: 5, right: 5, top: '9%', height: '82%', opacity: 0.8, animation: reduced ? undefined : 'cknerv-cell-specimen-sweep 2.8s linear infinite', pointerEvents: 'none', willChange: reduced ? undefined : 'transform, opacity' }}
        >
          <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg,transparent,${rgba(CELL_CARD_ACCENT, 0.85)},${rgba(HUD_COLORS.orange, 0.46)},transparent)`, boxShadow: `0 0 9px ${rgba(CELL_CARD_ACCENT, 0.7)}` }} />
        </span>
        <span style={portraitBracket('tl')} /><span style={portraitBracket('tr')} />
        <span style={portraitBracket('bl')} /><span style={portraitBracket('br')} />
      </section>

      {/* CKBYTES, under the CELL SCAN square, for every Cell that holds a byte
        * (the user's directions of 2026-09-05: 「hex reader 应该总是展示，可以把
        * 窗口放在 cell scan 下方合适位置」).
        *
        * It was a satellite that opened from a door in the DATA cluster and
        * stood in a 660 px column beside the plate. Two things were wrong with
        * that and the user named both: the surface was too large for what it
        * did, and a reader that has to be opened is a reader nobody opens. So
        * the door is gone, the column is gone, and the zone stands where the
        * bytes it draws belong — directly under the square that portrays the
        * Cell they came from, wider than the square by the 120 px notch it
        * reaches toward the Cell itself.
        *
        * The plate is `CellScanReaderPlate` because its ink waits on the walk
        * and its geometry does not: the section is mounted at final size from
        * the first frame, and the leaf up there subscribes to the clock so
        * this body does not.
        *
        * `key={cell.id}` is NOT decoration. ⚠️ The reader carries a selection,
        * a scroll position and a copy acknowledgement, all of them about the
        * bytes they were made over; it used to be unmounted on a Cell change
        * by `readerOpen === (request.cellId === cell.id)`, and an always-on
        * zone has no such unmount. Without the key, a selection made on one
        * Cell would point at a byte of the next. */}
      {hasBytes ? (
        <CellScanReaderPlate beside={readerBeside}>
          <CellDataReader
            key={cell.id}
            segments={readerSegments}
            {...outputData}
            totalBytes={cell.data_bytes}
            visibleRows={readerRows}
            focus={readerFocus}
            onFocusChange={releaseSegmentFocus}
          />
        </CellScanReaderPlate>
      ) : null}

      {/* Growth is strictly vertical: an arming trace appends a full-width
        * row below both columns instead of splitting one, and the analysis
        * plate's own geometry never moves. */}
      {showTracePlate && traceReadout ? (
          <section
            aria-label="Consensus memory trace"
            data-cell-detail-module="trace"
            data-cell-inspection-satellite="trace"
            data-cell-detail-size="content"
            style={{
              ...satelliteBase,
              gridArea: 'trace',
              width: 'auto',
              overflow: 'visible',
              padding: '8px 10px 10px 12px',
              ...spatialPlate(HUD_COLORS.memory),
            }}
          >
            <SpatialPlateHeader
              en="MEMORY TRACE"
              accent={HUD_COLORS.memory}
              titleColor={HUD_COLORS.memoryInk}
              marginBottom={0}
              status={(
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.6 }}>
                    LIVE EVIDENCE
                  </span>
                  {moduleTag('SCAN·02')}
                </span>
              )}
            />
            {/* The plate spans the card; the ledger rows keep a readable
              * measure — micro-type evidence lines stretched to the full
              * card width read as unbounded spreads. */}
            <div style={{ minWidth: 0, maxWidth: 560 }}>
              <ConsensusMemoryTracePlate
                readout={traceReadout}
                reducedMotion={reduced}
                targetContentHash={identity.contentHash}
                agreementCount={agreementTarget}
                focusedSourceId={traceEvidenceFocusSourceId}
                previewSourceId={traceEvidencePreviewSourceId}
                onFocusChange={onTraceEvidenceFocusChange}
                focusedHop={traceRouteHopFocus}
                onHopFocusChange={onTraceRouteHopFocusChange}
                lockedHop={traceRouteHopLock}
                onHopLockChange={onTraceRouteHopLockChange}
                routeCellById={inspectedCellById}
              />
            </div>
          </section>
      ) : null}

    </div>
    </CellScanClockContext.Provider>
  );
}

// Memoized behind the overlay's own memo: the overlay re-renders itself for a
// facet focus (it re-tints the connector from state), and that render carried
// the whole dossier with it — the same props, spread through unchanged. The
// facet's click already re-renders this body once for its own selection state;
// this saves the second pass.
export default memo(CellDetailPanel);
