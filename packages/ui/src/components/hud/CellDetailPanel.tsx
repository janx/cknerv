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
import { HUD_COLORS, HUD_FONTS, rgba, HUD_TYPE } from './hudTheme';
import {
  CloseButton,
  moduleTag,
  PlateReadoutCaption,
  PlateReadoutRow,
  plateStateChip,
  PLATE_ROW_RAIL_ALPHA,
  REVEAL_GHOST_OPACITY,
  revealStageAttributes,
  revealStageStyle,
  satelliteBase,
  SpatialPlateHeader,
  spatialPlate,
} from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait from './CellNucleusPortrait';
import { ConsensusMemoryTracePlate } from './ConsensusIdentityPlate';
import CellContentMemory from './CellContentMemory';
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
import { validateCellSemanticRecordForMorphology } from '../../derives/cellSemanticMorphology.derive';
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
  enrichmentSourceColor,
  enrichmentStatusMessage,
  EvidenceFact,
  FacetEvidenceRow,
  primarySemanticFacet,
  semanticAssetAmountReadout,
  semanticAssetIdentityReadout,
  semanticFacetNumber,
  semanticFacetValue,
  semanticObjectReadout,
  type CellSemanticsPhase,
} from './CellSemanticsReadout';

const EMPTY_RECENT_LINKS: readonly CellLink[] = [];
const PORTRAIT_BRACKET_PX = 12;
/** The CELL SCAN square is an independent column beside the analysis plate:
 * 520 of analysis + an 8px seam + the 280 square, one constant geometry for
 * bare and enriched Cells alike. */
const PORTRAIT_COLUMN_PX = 280;
const CARD_SEAM_PX = 8;
const ANALYSIS_COLUMN_PX = 520;
const CARD_WIDTH_PX = ANALYSIS_COLUMN_PX + CARD_SEAM_PX + PORTRAIT_COLUMN_PX;

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
/** OWNER · SCRIPT · ARGS — what the index adds to a lock, every time — and
 *  the one caption among them (OWNER explains where the address came from). */
const LOCK_ENRICHMENT_ROWS = 3;
const LOCK_ENRICHMENT_CAPTIONS = 1;
/** The typical asset block: two of amount/identity/object plus script hash. */
const ASSET_ENRICHMENT_ROWS = 3;
/** The BYTE BUDGET is one instrument (header, bar, legend, ratio strip), not
 *  a row stack — but three ghost rows is what stands in for it, and a slot
 *  must reserve EXACTLY the ghost that fills it or it settles by the
 *  difference the moment the record arrives. One number, one function. */
const BYTE_BUDGET_GHOST_ROWS = 3;

function reservedEvidenceHeight(rows: number, captions = 0): number {
  return rows * EVIDENCE_ROW_PX
    + Math.max(0, rows - 1) * EVIDENCE_ROW_GAP_PX
    + captions * EVIDENCE_CAPTION_PX;
}

const CYAN = HUD_COLORS.cyanWire;
const VIOLET = HUD_COLORS.memory;
const GOLD = HUD_COLORS.orange;

// ——— Provenance footer captions ——————————————————————————————————————
// Every row down here names a piece of record-keeping, and a label alone
// leaves the reader to guess which one. One short sentence each, in the house
// caption grammar: what the row is, never a second number.
/** MEMORY TRACE exists only while the creating link is still in the retained
 *  causal ring — that retention IS the row. */
const TRACE_CAPTION = 'THE CREATING WRITE THIS SESSION STILL HOLDS IN MEMORY';
const TRACE_CAPTION_RECALL = `${TRACE_CAPTION} · SELECT TO REPLAY ITS INPUTS`;
/** PROOF is the index's anchor block: the height everything the index added
 *  above was true at. */
const PROOF_CAPTION = 'ENRICHMENT ANCHOR · EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK';

type RowDecode = { label: string; value: string; color?: string };
export type CellInspectionFacet = ConsensusBraidField;
export type CellDetailLayoutSide = 'left' | 'right' | 'above' | 'below';

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
  if (!script || script.deprecated == null) return undefined;
  const deprecated = script.deprecated === true;
  const color = deprecated ? HUD_COLORS.danger : HUD_COLORS.nominal;
  return (
    <span
      data-cell-script-state={deprecated ? 'deprecated' : 'active'}
      style={{ flex: '0 0 auto', ...plateStateChip(color) }}
    >
      {deprecated ? 'DEPRECATED' : 'ACTIVE'}
    </span>
  );
}

/** A DAO moment: the block it happened in, and — once the source states the
 *  timestamp — the wall clock a human remembers it by. */
function daoMomentReadout(
  facet: SemanticFacet,
  blockKey: string,
  atMsKey: string,
): string | null {
  const block = semanticFacetNumber(facet, blockKey);
  if (block === null) return null;
  const atMs = semanticFacetNumber(facet, atMsKey);
  return atMs !== null && atMs > 0
    ? `${formatBlockRef(block)} · ${formatWallClock(atMs)}`
    : formatBlockRef(block);
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
  const accent = color ?? HUD_COLORS.cyanWire;
  return (
    <button
      type="button"
      data-cell-detail-field={field}
      data-cell-detail-field-state={selected ? 'focused' : revealed ? 'resolved' : 'scanning'}
      aria-pressed={selected}
      disabled={!interactive}
      onClick={() => onActivate(field)}
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 43,
        margin: 0,
        padding: '6px 7px 5px 10px',
        border: 0,
        borderLeft: `1px solid ${selected ? accent : rgba(accent, 0.34)}`,
        background: selected
          ? `linear-gradient(90deg,${rgba(accent, 0.17)},transparent 88%)`
          : 'transparent',
        boxShadow: selected ? `-3px 0 10px ${rgba(accent, 0.22)}` : undefined,
        color: accent,
        font: 'inherit',
        textAlign: 'left',
        cursor: interactive ? 'crosshair' : 'default',
        opacity: revealed ? 1 : 0.18,
        transition: 'opacity 260ms ease, background 160ms ease, box-shadow 160ms ease',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      <span style={{ display: 'block', fontSize: HUD_TYPE.label, letterSpacing: 1.2, color: HUD_COLORS.dim }}>
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
function CellScanFacetRow({ facet, revealAt }: {
  facet: SemanticFacet;
  revealAt: number;
}) {
  const revealed = useCellScanStepLit(revealAt);
  return <FacetEvidenceRow facet={facet} style={revealInk(revealed)} />;
}

/** SCANNING nn% → LOCKED, and the lattice count beside it. One span of text
 *  is the only thing in the card that has anything new to say every 80ms. */
function CellScanStatusReadout({ landmarks }: { landmarks: number }) {
  const frame = useCellScanFrame();
  const color = frame.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire;
  return (
    <span
      data-cell-identity-scan-status="true"
      style={{ color, fontSize: HUD_TYPE.label, letterSpacing: 0.72, textShadow: `0 0 7px ${rgba(color, 0.42)}` }}
    >
      {frame.classified ? 'LOCKED' : `SCANNING ${frame.pct}%`}
      {' · '}A-LATTICE {Math.min(frame.lit, landmarks)}/{landmarks}
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
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: `linear-gradient(180deg,transparent,${HUD_COLORS.cyanWire},transparent)`, boxShadow: `0 0 12px ${HUD_COLORS.cyanWire}` }} />
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
      data-consensus-memory-reveal="trace"
      data-consensus-memory-reveal-state={revealed ? 'resolved' : 'scanning'}
      {...revealStageAttributes(revealed)}
      style={{ display: 'block', marginTop: 4, paddingTop: 2, borderTop: `1px solid ${rgba(CYAN, 0.09)}`, ...revealStageStyle(revealed) }}
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
          title={!identityProofComplete
            ? 'ARM MEMORY TRACE · read the three identity proofs by selecting STATE (WHERE), DATA (WHAT) and COMMIT (WHEN) in the register above'
            : observed.txHash}
          onClick={() => onTraceWrite(observed.seq)}
          disabled={!recallEnabled}
          style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', gap: '2px 8px', width: '100%', margin: 0, padding: '3px 2px', border: 0, background: traceSelected ? `${VIOLET}12` : 'transparent', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: traceSelected ? HUD_COLORS.memoryInk : GOLD, textShadow: `0 0 6px ${traceSelected ? VIOLET : GOLD}55`, whiteSpace: 'nowrap', cursor: recallEnabled ? 'pointer' : 'default', textAlign: 'left', opacity: recallEnabled ? 1 : 0.62 }}
        >
          <span>MEMORY TRACE</span>
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
            {formatBlockRef(observed.block)} · {observed.inputCount}→{observed.outputCount} · {traceStateReadout}
          </span>
          <PlateReadoutCaption style={{ gridColumn: '1 / -1', whiteSpace: 'normal' }}>
            {TRACE_CAPTION_RECALL}
          </PlateReadoutCaption>
        </button>
      ) : (
        <div
          data-write-observed="true"
          title={observed.txHash}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: GOLD, textShadow: `0 0 6px ${GOLD}55`, whiteSpace: 'nowrap' }}
        >
          <span>MEMORY TRACE</span>
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
            {formatBlockRef(observed.block)} · {observed.inputCount}→{observed.outputCount}
          </span>
          <PlateReadoutCaption style={{ flexBasis: '100%', whiteSpace: 'normal' }}>
            {TRACE_CAPTION}
          </PlateReadoutCaption>
        </div>
      )}
    </div>
  );
}

export default function CellDetailPanel({
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
  // Composition backfill emits born_at_ms 0 for records born before the
  // retained window — an epoch-relative age would read as decades.
  const lifetime = cell.born_at_ms > 0
    ? `AGE ${formatAge(cell.born_at_ms, Date.now())}`
    : `SINCE ${formatBlockRef(cell.birth_block)}`;
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

  const DECODE: Record<CellInspectionFacet, RowDecode> = {
    capacity: { label: 'CAPACITY', value: formatCkb(cell.capacity) },
    asset: {
      label: 'ASSET',
      value: formatScriptIdentity(
        formatAssetKind(cell.asset_kind),
        presentedSemanticRecord?.type_script,
      ),
      color: scriptIdentityColor(
        cell.asset_kind,
        ASSET_COLORS,
        presentedSemanticRecord?.type_script,
      ),
    },
    lock: {
      label: 'LOCK',
      value: formatScriptIdentity(
        formatLockKind(cell.lock_kind),
        presentedSemanticRecord?.lock_script,
      ),
      color: scriptIdentityColor(
        cell.lock_kind,
        LOCK_COLORS,
        presentedSemanticRecord?.lock_script,
      ),
    },
    data: {
      label: 'DATA',
      value: formatCellData(cell.data_bytes),
      color: HUD_COLORS.nominal,
    },
    state: {
      label: 'STATE',
      value: live ? '● LIVE' : '◇ SPENT',
      color: live ? HUD_COLORS.nominal : HUD_COLORS.caution,
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
  const cardRows = portraitFirst
    ? '"header header" "scan analysis"'
    : '"header header" "analysis scan"';
  const cardAreas = showTracePlate ? `${cardRows} "trace trace"` : cardRows;

  // ——— Register cluster evidence ————————————————————————————————————
  const facet = presentedSemanticRecord
    ? primarySemanticFacet(presentedSemanticRecord)
    : null;
  // The DAO position is spelled out row by row below; every other facet keeps
  // the generic one-line summary.
  const daoFacet = presentedSemanticRecord?.facets.find(
    (candidate) => candidate.kind === 'dao',
  ) ?? null;
  const genericFacet = facet && facet.kind !== 'dao' ? facet : null;
  const assetAmount = presentedSemanticRecord
    ? semanticAssetAmountReadout(presentedSemanticRecord)
    : null;
  const assetIdentity = presentedSemanticRecord
    ? semanticAssetIdentityReadout(presentedSemanticRecord)
    : null;
  const assetObject = semanticObjectReadout(presentedSemanticRecord);
  const lockScript = presentedSemanticRecord?.lock_script ?? null;
  const typeScript = presentedSemanticRecord?.type_script ?? null;
  const lockAccent = DECODE.lock.color ?? CYAN;
  const assetAccent = DECODE.asset.color ?? CYAN;
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
      || typeScript || daoFacet || genericFacet || enrichmentPending,
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
        gridTemplateColumns: portraitFirst
          ? `${PORTRAIT_COLUMN_PX}px minmax(0, 1fr)`
          : `minmax(0, 1fr) ${PORTRAIT_COLUMN_PX}px`,
        // The trace row exists only while the armed MEMORY TRACE window is
        // appended — an always-there empty row would trail an 8px phantom gap
        // under the analysis plate.
        gridTemplateAreas: cardAreas,
        columnGap: CARD_SEAM_PX,
        rowGap: 8,
        alignItems: 'start',
        width: CARD_WIDTH_PX,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow around the constellation replaces a separate
        // filter surface for every satellite. It follows the silhouette, so
        // the scan square and the plate beside it cast one shadow instead of
        // two stacked ones. The cyanWire here is a deliberate pin: the peer
        // cards derive this glow from a live accent, and the cell card has no
        // card-level accent to derive it from — its chrome is cyan, full stop.
        filter: `drop-shadow(0 8px 16px rgba(0,0,0,.56)) drop-shadow(0 0 14px ${rgba(HUD_COLORS.cyanWire, 0.06)})`,
        animation: reduced
          ? undefined
          : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
        ...style,
      }}
    >
      <section
        data-cell-inspection-satellite="identity"
        data-cell-scan-identity
        style={{
          ...satelliteBase,
          gridArea: 'header',
          minHeight: 58,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 10px',
          minWidth: 0,
          padding: '9px 38px 8px 16px',
          ...spatialPlate(HUD_COLORS.orange),
        }}
      >
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.display, fontSize: HUD_TYPE.title, fontWeight: 600, letterSpacing: 2, textShadow: `0 0 9px ${rgba(HUD_COLORS.orange, 0.45)}` }}>
          CELL // #{cell.id}
        </span>
        {/* The house CJK companion, as PEER wears 对端 and NODE wears 节点.
          * 细胞 is in the hand-subset woff2 (fonts/README.md) — deliberate
          * presence, where SightedNodeCard documents a deliberate absence. */}
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.cjk, fontSize: HUD_TYPE.label, opacity: 0.72 }}>
          细胞
        </span>
        {/* The outpoint, which is what a viewer can look up anywhere else —
          * the old head of the content hash beside an output index read like
          * an outpoint and was not one. */}
        <span title={cell.out_point.tx_hash} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, letterSpacing: 0.8 }}>
          {formatOutpoint(cell.out_point.tx_hash, cell.out_point.index)}
        </span>
        <span style={{ marginLeft: 'auto', color: live ? HUD_COLORS.nominal : HUD_COLORS.caution, fontSize: HUD_TYPE.section, letterSpacing: 0.9 }}>
          {live ? '● LIVE' : '◇ SPENT'} · {lifetime}
        </span>
        {/* In-flow, not corner-stamped: an absolute stamp sat exactly where a
          * long lifetime readout ends, and the two printed over each other. */}
        <span style={{ whiteSpace: 'nowrap' }}>
          {moduleTag('SCAN·01')}
        </span>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      <section
        aria-label="Interactive Cell scan"
        data-cell-detail-module="specimen"
        data-cell-inspection-satellite="specimen"
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
          boxShadow: `inset 0 0 26px ${rgba(HUD_COLORS.cyanWire, 0.08)},0 0 20px ${rgba(HUD_COLORS.orange, 0.06)}`,
        }}
      >
        <div style={{ position: 'absolute', zIndex: 3, left: 12, top: 10, right: 12, display: 'flex', alignItems: 'baseline', gap: 8, pointerEvents: 'none' }}>
          <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.section, fontWeight: 700, letterSpacing: 1.45, whiteSpace: 'nowrap' }}>CELL SCAN</span>
          <span data-cell-scan-drag-affordance style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.8, whiteSpace: 'nowrap' }}>{verticalLayout ? 'ORBIT ↔' : 'DRAG TO ORBIT ↔'}</span>
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
          <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg,transparent,${rgba(HUD_COLORS.cyanWire, 0.85)},${rgba(HUD_COLORS.orange, 0.46)},transparent)`, boxShadow: `0 0 9px ${rgba(HUD_COLORS.cyanWire, 0.7)}` }} />
        </span>
        <span style={portraitBracket('tl')} /><span style={portraitBracket('tr')} />
        <span style={portraitBracket('bl')} /><span style={portraitBracket('br')} />
      </section>

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
          overflow: 'hidden',
          // One rectangle, one column: plate header, register clusters, bytes
          // zone, provenance footer — the house plate's own 12px cut corner is
          // the only shape it wears.
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          rowGap: 8,
          alignContent: 'start',
          padding: '9px 12px 10px 14px',
          ...spatialPlate(HUD_COLORS.cyanWire),
        }}
      >
        <CellScanSweep plateRef={analysisPlateRef} reduced={reduced} />

        <SpatialPlateHeader
          en="CKBYTES ANALYSIS"
          accent={HUD_COLORS.cyanWire}
          marginBottom={0}
          status={(
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <CellScanStatusReadout landmarks={order.length} />
              {moduleTag('SCAN·02')}
            </span>
          )}
        />

        <div
          data-cell-analysis-register="true"
          style={{ minWidth: 0, display: 'grid', gap: 6, alignContent: 'start' }}
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
                      title={presentedSemanticRecord.address}
                      caption="ADDRESS ENCODED FROM THE LOCK SCRIPT"
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
                  {assetAmount ? (
                    <ClusterRow
                      row="amount"
                      accent={assetAccent}
                      label="AMOUNT"
                      value={assetAmount}
                      valueColor={HUD_COLORS.caution}
                      valueSize={HUD_TYPE.value}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {assetIdentity ? (
                    <ClusterRow
                      row="identity"
                      accent={assetAccent}
                      label="IDENTITY"
                      value={assetIdentity}
                      valueColor={HUD_COLORS.caution}
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
                      valueColor={HUD_COLORS.caution}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {daoFacet ? [
                    ['dao-deposited', 'DEPOSITED', 'deposit_block', 'deposit_at_ms'],
                    ['dao-withdraw-request', 'WITHDRAW REQ', 'withdraw_request_block', 'withdraw_request_at_ms'],
                    ['dao-withdrawn', 'WITHDRAWN', 'withdraw_block', 'withdraw_at_ms'],
                  ].map(([row, label, blockKey, atMsKey]) => {
                    const value = daoMomentReadout(daoFacet, blockKey, atMsKey);
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
                      valueColor={HUD_COLORS.caution}
                      revealAt={semanticsRevealAt(1)}
                    />
                  ) : null}
                  {genericFacet ? (
                    <CellScanFacetRow
                      facet={genericFacet}
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
            {/* When the Cell was written, in a clock a human keeps. Composition
              * backfill emits born_at_ms 0 for Cells born before the retained
              * window, and an epoch-relative date would be a lie — those keep
              * the block anchor alone, which the COMMIT fact already states. */}
            {cell.born_at_ms > 0 ? (
              <ClusterRow
                row="born"
                accent={CYAN}
                label="BORN"
                value={`${formatWallClock(cell.born_at_ms)} · ${formatBlockRef(cell.birth_block)}`}
                revealAt={factRevealAt('born')}
                style={{ gridColumn: '1 / -1', margin: CLUSTER_EVIDENCE_INDENT }}
              />
            ) : null}
          </div>

          {semanticSource && semanticPhase ? (
            <CellScanStagedBlock
              revealAt={semanticsRevealAt(1)}
              attributes={{
                'data-cell-semantics-phase': presentedSemanticPhase ?? semanticPhase,
                'data-cell-semantics-source': semanticSource.status,
              }}
              style={{ minWidth: 0, marginTop: 1 }}
            >
              {statusLine ? (
                <div title={statusLine} style={{ color: (presentedSemanticPhase ?? semanticPhase) === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: HUD_TYPE.label, lineHeight: 1.45 }}>
                  {statusLine}
                </div>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                <span aria-hidden="true" style={{ alignSelf: 'center', width: 4, height: 4, borderRadius: '50%', background: enrichmentSourceColor(semanticSource.status), boxShadow: `0 0 6px ${enrichmentSourceColor(semanticSource.status)}` }} />
                <span style={{ color: enrichmentSourceColor(semanticSource.status), fontSize: HUD_TYPE.micro, letterSpacing: 0.85, whiteSpace: 'nowrap' }}>
                  {semanticSource.status.toUpperCase()}
                </span>
                {semanticSource.lag_blocks != null ? (
                  <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.7, whiteSpace: 'nowrap' }}>
                    · {semanticSource.lag_blocks} BLOCK LAG
                  </span>
                ) : null}
              </div>
            </CellScanStagedBlock>
          ) : null}
        </div>

        <div
          data-cell-analysis-bytes="true"
          style={{
            minWidth: 0,
            paddingTop: 7,
            borderTop: `1px solid ${rgba(CYAN, 0.12)}`,
            display: 'grid',
            gap: 7,
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
                <GhostRows rows={BYTE_BUDGET_GHOST_ROWS} accent={GOLD} />
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
            />
          </div>
        </div>

        <div
          data-cell-provenance-footer="true"
          style={{ minWidth: 0, paddingTop: 4, borderTop: `1px solid ${rgba(VIOLET, 0.18)}` }}
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
          {presentedSemanticRecord ? (
            <CellScanStagedBlock
              revealAt={semanticsRevealAt(1)}
              attributes={{ 'data-cell-provenance-proof': 'true' }}
              style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 4, minWidth: 0 }}
            >
              <EvidenceFact
                label="PROOF"
                value={formatBlockRef(presentedSemanticRecord.as_of.block)}
                color={HUD_COLORS.cyanWire}
              />
              {createdDiffers ? (
                <EvidenceFact
                  label="CREATED"
                  value={formatBlockRef(
                    presentedSemanticRecord.observed_at_block,
                  )}
                />
              ) : null}
              <PlateReadoutCaption style={{ flexBasis: '100%' }}>
                {PROOF_CAPTION}
              </PlateReadoutCaption>
            </CellScanStagedBlock>
          ) : null}
        </div>
      </section>

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
                  <span style={{ color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.55 }}>
                    LIVE EVIDENCE
                  </span>
                  {moduleTag('SCAN·03')}
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
