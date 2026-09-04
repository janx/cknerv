import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticContentGuess,
  SemanticContentSegment,
  SemanticFacet,
} from '@cknerv/types';
import { deriveCellContentMemory } from '../../derives/cellContentMemory.derive';
import { segmentColorSlots } from '../../derives/cellDataReader.derive';
import { HUD_COLORS, HUD_FONTS, QUALITATIVE_BUCKET_COLORS, rgba, HUD_TYPE } from './hudTheme';
import { revealStageAttributes, revealStageStyle } from './primitives';
import { formatSemanticAssetAmount } from './cellFormat';
import type { CellSemanticsPhase } from './CellSemanticsReadout';

// The DATA cluster's window, which no longer prints a byte.
//
// It used to open with a status line, a 16×2 hex grid, an ASCII line and a
// READ ALL door, and the analysis under all of that was the part a reader came
// for. The user's direction of 2026-09-05 — 「cell detail 中原有的 cell data
// hex reading 可以去掉，避免 UX 冗余」 — took the bytes out, because CKBYTES
// (SCAN·03) now stands under the CELL SCAN square for every Cell that holds
// any, sixteen a row with offsets and ASCII and the whole payload behind them.
// Thirty-two bytes with no offsets, drawn a second time three centimetres
// above a window that draws all of them, were the redundancy.
//
// So this window is the READING and nothing else: what the decode found, every
// segment it found, what the guesses say, what role the Cell plays. It states
// the size of nothing — the DATA fact directly above it already does — and a
// Cell nobody indexed gets no window at all, because with the bytes gone there
// would be nothing in it but the absence of a record.
//
// A segment row is the one control left, and it points DOWN: pressing it sends
// the reader under the square to that segment's first byte and glows its bytes.
// That is the whole link between the two surfaces, and it is why the reader
// could give up its own segment rail.

/**
 * Height the analysis zone holds while the index still owes this window an
 * answer.
 *
 * Everything in the window is the reading now, and every line of the reading
 * waits on a record that has not landed — so the reservation is the whole zone
 * rather than the tail of it. Rows that arrive into no reservation shove the
 * provenance footer and the MEMORY TRACE affordance down mid-read, and this is
 * the LAST cluster before that footer.
 *
 * Reservation math only — the browser lays the real rows out. The zone's
 * tallest shape, line by line, at the type it prints:
 *
 *     VALUE                                        12
 *     DECODE · kind · summary                   2 + 12
 *     · seven segment rows       7 × (3 + 3 + 1 + 12) = 133
 *     HEURISTIC                             3 + 3 + 1 + 15
 *     ROLE                                       3 + 15
 *                                                 ————
 *                                                  199
 *
 * SEVEN segment rows is the spore layout, which is the tallest deterministic
 * decode the index emits today — and the rows are where this number grew. The
 * zone used to hold ONE segment behind a stepper, so its reservation was a
 * single line and a pair of 15 px buttons; the stepper is gone (the user's R2-1
 * ruling) because a list a reader has to walk one item at a time is not a list,
 * and the reservation now holds what the list actually needs.
 *
 * The terms are the generous reading of each line box on purpose: a floor that
 * is a pixel short is a floor that still shoves the footer. A record that brings
 * fewer rows than this settles the cluster down ONCE — the same bargain every
 * other pending slot on this card makes.
 */
export const CELL_CONTENT_ANALYSIS_RESERVED_PX = 199;

function readableKind(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase();
}

function analysisTone(source?: EnrichmentSourceStatus): string {
  if (!source) return HUD_COLORS.dim;
  if (source.status === 'ready') return HUD_COLORS.nominal;
  if (source.status === 'stale') return HUD_COLORS.caution;
  if (source.status === 'error' || source.status === 'incompatible') {
    return HUD_COLORS.danger;
  }
  return HUD_COLORS.cyanWire;
}

function navButtonStyle(enabled: boolean): CSSProperties {
  return {
    width: 18,
    height: 15,
    margin: 0,
    padding: 0,
    border: `1px solid ${enabled ? rgba(HUD_COLORS.cyanWire, 0.28) : rgba(HUD_COLORS.dim, 0.12)}`,
    background: enabled ? rgba(HUD_COLORS.cyanWire, 0.06) : 'transparent',
    color: enabled ? HUD_COLORS.cyanWire : HUD_COLORS.dim,
    font: `${HUD_TYPE.label}px ${HUD_FONTS.mono}`,
    lineHeight: 1,
    cursor: enabled ? 'pointer' : 'default',
    pointerEvents: enabled ? 'auto' : 'none',
    opacity: enabled ? 1 : 0.4,
  };
}

/**
 * A segment row: the steppers' hand-over grammar stretched from one glyph to a
 * whole line.
 *
 * The three properties that carry the hand-over — the pointer, the ink and the
 * tab stop — are exactly `navButtonStyle`'s, said again here rather than spread
 * from it, because everything else about that style is sized for a single `‹`
 * and a row would override all of it. What a reader has learned holds: a
 * control on this window is readable before its stage arrives and inert until
 * it does.
 *
 * PRESSED is a wash and a brighter dot, never a louder rule: the rule between
 * two rows is structure and stays at the house rung whichever row is pressed.
 * The row is not selecting anything here — it is POINTING at bytes on another
 * surface — so `aria-pressed` is the whole of the semantics.
 */
function segmentRowStyle(
  interactive: boolean,
  pressed: boolean,
  color: string,
): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '5px auto auto minmax(0, 1fr)',
    alignItems: 'baseline',
    gap: 5,
    width: '100%',
    minWidth: 0,
    margin: '3px 0 0',
    padding: '3px 3px 0',
    border: 0,
    borderTop: `1px solid ${rgba(color, 0.16)}`,
    background: pressed ? rgba(color, 0.08) : 'transparent',
    font: `${HUD_TYPE.label}px ${HUD_FONTS.mono}`,
    lineHeight: 1.35,
    textAlign: 'left',
    cursor: interactive ? 'pointer' : 'default',
    pointerEvents: interactive ? 'auto' : 'none',
    opacity: interactive ? 1 : 0.4,
  };
}

function cycleIndex(
  current: number,
  length: number,
  direction: -1 | 1,
): number {
  if (length <= 1) return 0;
  return (current + direction + length) % length;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/**
 * Every segment the decode found, in record order, one row each.
 *
 * It was a stepper — `‹ S 01/07 ›`, one segment on screen — and a reader who
 * wanted the fifth pressed `›` four times to reach it, having had no way to
 * learn there were seven. The user's R2-1 ruling replaced it with the list it
 * was hiding, which is what makes this cluster a table of contents for the
 * bytes under the square, and what let CKBYTES drop its own segment rail.
 */
function SegmentRows({
  segments,
  slots,
  focusedSegment,
  interactive,
  onFocus,
}: {
  segments: readonly SemanticContentSegment[];
  /** The slots the shared rule gave these segments. Handed in rather than
   *  worked out here: `index % 6` made the colour a fact about the segment's
   *  PLACE in the record's list, so a decode that gained a field repainted
   *  every segment after it, and the portrait — which hashed the label instead
   *  — disagreed with this window about every Cell they both drew. */
  slots: readonly number[];
  /** Which row the reader is standing on, as the CARD reports it. The window
   *  does not own this: a byte click in the reader unpresses the row, and a
   *  window that remembered its own press would disagree with the bytes. */
  focusedSegment: number | null;
  /** A stage the probe has not reached yet is readable-but-inert: its rows take
   *  no click and no tab stop until its moment arrives. */
  interactive: boolean;
  onFocus?: (index: number) => void;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        const color = QUALITATIVE_BUCKET_COLORS[
          (slots[index] ?? 0) % QUALITATIVE_BUCKET_COLORS.length
        ];
        const pressed = focusedSegment === index;
        return (
          <button
            key={index}
            type="button"
            data-cell-content-segment={index}
            data-cell-content-segment-range={`${segment.start_byte}:${segment.end_byte}`}
            aria-pressed={pressed}
            disabled={!interactive}
            onClick={() => onFocus?.(index)}
            style={segmentRowStyle(interactive, pressed, color)}
          >
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, background: color, boxShadow: pressed ? `0 0 5px ${color}` : undefined }}
            />
            <span title={segment.label} style={{ color: HUD_COLORS.cyanInk, fontSize: HUD_TYPE.label, whiteSpace: 'nowrap' }}>
              {readableKind(segment.label)}
            </span>
            {/* Where the bytes are AND how many, because the reader below is
                addressed in offsets and a range with no width is half an
                address. */}
            <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, whiteSpace: 'nowrap' }}>
              [{segment.start_byte}..{segment.end_byte}) · {segment.end_byte - segment.start_byte} B
            </span>
            <span title={segment.meaning} style={{ minWidth: 0, color, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {segment.value}
            </span>
          </button>
        );
      })}
    </>
  );
}

function GuessReadout({
  guess,
  index,
  count,
  interactive,
  onStep,
}: {
  guess: SemanticContentGuess;
  index: number;
  count: number;
  interactive: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  const stepEnabled = interactive && count > 1;
  return (
    <div
      data-cell-content-heuristic={index}
      style={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0,1fr) 18px', alignItems: 'baseline', gap: 4, minWidth: 0, marginTop: 3, paddingTop: 3, borderTop: `1px solid ${rgba(HUD_COLORS.caution, 0.16)}` }}
    >
      <button
        type="button"
        aria-label="previous heuristic"
        disabled={!stepEnabled}
        onClick={() => onStep(-1)}
        style={navButtonStyle(stepEnabled)}
      >
        ‹
      </button>
      <span style={{ color: HUD_COLORS.caution, fontSize: HUD_TYPE.micro, whiteSpace: 'nowrap' }}>
        H{index + 1}/{count} · {guess.confidence.toUpperCase()}
      </span>
      <span title={`${guess.reason}${guess.mime_type ? ` · ${guess.mime_type}` : ''}${guess.value ? ` · ${guess.value}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {readableKind(guess.kind)} · {guess.mime_type ?? guess.value ?? guess.reason}
      </span>
      <button
        type="button"
        aria-label="next heuristic"
        disabled={!stepEnabled}
        onClick={() => onStep(1)}
        style={navButtonStyle(stepEnabled)}
      >
        ›
      </button>
    </div>
  );
}

function FacetReadout({
  facet,
  index,
  count,
  interactive,
  onStep,
}: {
  facet: SemanticFacet;
  index: number;
  count: number;
  interactive: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  const first = facet.attributes[0];
  const stepEnabled = interactive && count > 1;
  return (
    <div
      data-cell-content-role={index}
      style={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0,1fr) 18px', alignItems: 'baseline', gap: 4, minWidth: 0, marginTop: 3 }}
    >
      <button
        type="button"
        aria-label="previous Cell role"
        disabled={!stepEnabled}
        onClick={() => onStep(-1)}
        style={navButtonStyle(stepEnabled)}
      >
        ‹
      </button>
      <span style={{ color: HUD_COLORS.memoryInk, fontSize: HUD_TYPE.micro, whiteSpace: 'nowrap' }}>
        ROLE {index + 1}/{count}
      </span>
      <span title={`${facet.kind}${facet.state ? ` · ${facet.state}` : ''}${first ? ` · ${first.key}: ${first.value}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {readableKind(facet.kind)}{facet.state ? ` · ${facet.state.toUpperCase()}` : ''}{first ? ` · ${readableKind(first.key)} ${first.value}${first.unit ? ` ${first.unit}` : ''}` : ''}
      </span>
      <button
        type="button"
        aria-label="next Cell role"
        disabled={!stepEnabled}
        onClick={() => onStep(1)}
        style={navButtonStyle(stepEnabled)}
      >
        ›
      </button>
    </div>
  );
}

export default function CellContentMemory({
  dataHex,
  source,
  phase,
  record,
  message,
  reveal = 1,
  pending = false,
  focusedSegment = null,
  onSegmentFocus,
}: {
  dataHex: string;
  source?: EnrichmentSourceStatus;
  phase?: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
  /** Shared Cell scan progress; present content is decoded in source order. */
  reveal?: number;
  /** The card's one verdict on whether a record is still on its way. While it
   *  is, the analysis zone holds the height that record will need. */
  pending?: boolean;
  /** Which segment CKBYTES is standing on, if it is standing on one of this
   *  Cell's. The window does not own it — the card does, keyed by Cell — and
   *  only reports it. */
  focusedSegment?: number | null;
  /** Send the reader to a segment's first byte.
   *
   *  OPTIONAL, and that is the whole compatibility story: a window rendered
   *  without it — the tuning lab, a test of the bare window — still lists every
   *  segment and reads exactly as it does here, because a row that moves a
   *  reader nobody mounted has nowhere to send one. */
  onSegmentFocus?: (index: number) => void;
}) {
  const enhanced = Boolean(source && phase);
  const content = record?.content;
  const model = useMemo(
    () => deriveCellContentMemory(dataHex, content),
    [content, dataHex],
  );
  const segments = content?.deterministic?.segments ?? [];
  // The one rule every surface that colours these bytes asks — this window,
  // the portrait's byte rail, and the reader under the square. Read once per
  // record rather than per row.
  const segmentSlots = useMemo(() => segmentColorSlots(segments), [segments]);
  const guesses = content?.heuristics ?? [];
  const roles = record?.facets ?? [];
  const [guessIndex, setGuessIndex] = useState(0);
  const [roleIndex, setRoleIndex] = useState(0);
  const contentKey = `${record?.out_point.tx_hash ?? 'direct'}:${record?.out_point.index ?? 0}:${content?.deterministic?.kind ?? 'raw'}:${content?.data_hex ?? dataHex}`;
  const selectedGuessIndex = guesses.length === 0
    ? null
    : Math.min(guessIndex, guesses.length - 1);
  const selectedGuess = selectedGuessIndex === null
    ? null
    : guesses[selectedGuessIndex];
  const selectedRoleIndex = roles.length === 0
    ? null
    : Math.min(roleIndex, roles.length - 1);
  const selectedRole = selectedRoleIndex === null ? null : roles[selectedRoleIndex];
  useEffect(() => {
    setGuessIndex(0);
    setRoleIndex(0);
  }, [contentKey]);
  const assetAmount = record?.asset?.amount == null
    ? null
    : `${formatSemanticAssetAmount(
      record.asset.amount,
      record.asset.decimals,
    )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`;
  const tone = analysisTone(source);
  const statusMessage = phase === 'loading'
    ? 'RESOLVING INDEXED CONTENT ANALYSIS…'
    : phase === 'waiting'
      ? (message ?? 'WAITING FOR A VALIDATED CONTENT RECORD')
      : phase === 'unavailable'
        ? (message ?? 'NO INDEXED CONTENT RECORD')
        : phase === 'error'
          ? (message ?? 'CONTENT ANALYSIS UNAVAILABLE')
          : record && !content
            ? 'INDEX HAS NO CONTENT PAYLOAD FOR THIS CELL'
            : null;
  // The reading, in the order it is read: what the Cell is worth, what the
  // decode called it, where each of its fields is, what the guesses think, what
  // role it plays. `segments` is its own stage and sits directly after
  // `decode`, so the rows light after the line that names the decode they came
  // out of — and before the heuristics, which are guesses about the same bytes.
  const revealStages = [
    ...(record?.asset ? ['asset'] : []),
    'decode',
    ...(segments.length > 0 ? ['segments'] : []),
    ...(selectedGuess ? ['heuristic'] : []),
    ...(selectedRole ? ['role'] : []),
  ];
  const revealProgress = clampUnit(reveal);
  // Match the landmark scan: the first item resolves shortly after travel,
  // then each item joins the layout in sequence. The final frame is stable.
  const revealedStageCount = revealProgress >= 1
    ? revealStages.length
    : Math.min(
      revealStages.length,
      Math.floor(revealProgress * revealStages.length + 0.45),
    );
  const stageRevealed = (stage: string): boolean => {
    const index = revealStages.indexOf(stage);
    return index >= 0 && index < revealedStageCount;
  };
  const assetRevealed = stageRevealed('asset');
  const decodeRevealed = stageRevealed('decode');
  const segmentsRevealed = stageRevealed('segments');
  const heuristicRevealed = stageRevealed('heuristic');
  const roleRevealed = stageRevealed('role');
  const analysisRevealed = assetRevealed
    || decodeRevealed
    || segmentsRevealed
    || heuristicRevealed
    || roleRevealed;
  // A record is on its way: hold the rows it will fill, so its arrival
  // replaces a reservation instead of pushing the footer beneath it down.
  const analysisPending = pending && !record;

  // ⭐ NO INDEX, NO WINDOW. The window used to open a `DIRECT NODE · RAW` hex
  // view for the ~98% of Cells nobody has indexed; that view was CKBYTES'
  // ancestor, and CKBYTES draws all of those bytes under the square now, with
  // offsets, ASCII and a scrollbar that is the payload's own map. What is left
  // here for an unindexed Cell is a heading over nothing.
  if (!enhanced) return null;

  // A validly-empty output earns NO line either. It used to earn one — down
  // from the stack of negatives (the empty box, byte count, decode fallbacks)
  // that all restate the same absence — but the DATA fact directly above this
  // window already reads `Empty`. Absence is stated once, by the fact whose
  // subject it is. Most Cells in view are plain transfers, so this is the
  // common case.
  if (model.valid && model.complete && model.observedBytes === 0) return null;

  return (
    <section
      aria-label="Consensus memory content"
      data-cell-content-memory="true"
      data-cell-content-byte-origin={model.origin}
      data-cell-content-complete={model.complete ? 'true' : 'false'}
      data-cell-content-reveal-state={revealedStageCount === revealStages.length
        ? 'resolved'
        : 'scanning'}
      data-cell-content-reveal-count={revealedStageCount}
      data-cell-content-reveal-total={revealStages.length}
      style={{
        // Mounted whole, at final size, from the first frame: the walk below
        // only changes ink, and the one zone whose row count waits on the
        // index holds that height in advance. A window that grows a row while
        // it decodes is a window that moved under whoever was reading the row
        // above it.
        display: 'block',
        minWidth: 0,
        marginTop: 6,
        fontFamily: HUD_FONTS.mono,
      }}
    >
      {/* The rule over the reading is structure, not evidence: it is drawn
        * from the first frame, and only the rows below it stage. */}
      <div data-cell-content-analysis="true" data-cell-content-analysis-state={analysisRevealed ? 'resolved' : 'scanning'} data-cell-content-analysis-reserved={analysisPending ? 'true' : undefined} style={{ display: 'block', minWidth: 0, paddingTop: 2, borderTop: `1px solid ${rgba(tone, 0.16)}`, minHeight: analysisPending ? CELL_CONTENT_ANALYSIS_RESERVED_PX : undefined }}>
        {/* The asset line is a VALUE reading, so it wears the house's
          * value-emphasis gold rather than the caution yellow it used to —
          * the same gold the register's AMOUNT row two columns over uses. */}
        {record?.asset ? (
          <div data-cell-content-asset="true" data-cell-content-reveal-item="asset" data-cell-content-reveal-item-state={assetRevealed ? 'resolved' : 'scanning'} title={record.asset.type_script_hash} {...revealStageAttributes(assetRevealed)} style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0, color: HUD_COLORS.goldInk, fontSize: HUD_TYPE.label, ...revealStageStyle(assetRevealed) }}>
            <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 1.4 }}>VALUE</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[record.asset.symbol, record.asset.name, record.asset.standard].filter(Boolean).join(' · ') || record.asset.type_script_hash}
              {assetAmount ? ` · ${assetAmount}` : ''}
            </span>
          </div>
        ) : null}
        {content?.deterministic ? (
          <div data-cell-content-deterministic="true" data-cell-content-reveal-item="decode" data-cell-content-reveal-item-state={decodeRevealed ? 'resolved' : 'scanning'} {...revealStageAttributes(decodeRevealed)} style={{ display: 'block', minWidth: 0, marginTop: record?.asset ? 2 : 0, ...revealStageStyle(decodeRevealed) }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
              <span style={{ color: HUD_COLORS.nominal, fontSize: HUD_TYPE.micro, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
                DECODE · {readableKind(content.deterministic.kind)}
              </span>
              <span title={content.deterministic.summary} style={{ minWidth: 0, marginLeft: 'auto', color: HUD_COLORS.ink, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {content.deterministic.summary}
              </span>
            </div>
          </div>
        ) : statusMessage ? (
          <div data-cell-content-reveal-item="decode" data-cell-content-reveal-item-state={decodeRevealed ? 'resolved' : 'scanning'} title={statusMessage} {...revealStageAttributes(decodeRevealed)} style={{ display: 'block', marginTop: 2, color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...revealStageStyle(decodeRevealed) }}>
            {statusMessage}
          </div>
        ) : (
          <div data-cell-content-reveal-item="decode" data-cell-content-reveal-item-state={decodeRevealed ? 'resolved' : 'scanning'} {...revealStageAttributes(decodeRevealed)} style={{ display: 'block', marginTop: 2, color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, ...revealStageStyle(decodeRevealed) }}>
            NO DETERMINISTIC DECODE
          </div>
        )}
        {segments.length > 0 ? (
          <div data-cell-content-reveal-item="segments" data-cell-content-reveal-item-state={segmentsRevealed ? 'resolved' : 'scanning'} {...revealStageAttributes(segmentsRevealed)} style={{ display: 'block', minWidth: 0, ...revealStageStyle(segmentsRevealed) }}>
            <SegmentRows
              segments={segments}
              slots={segmentSlots}
              focusedSegment={focusedSegment}
              interactive={segmentsRevealed}
              onFocus={onSegmentFocus}
            />
          </div>
        ) : null}
        {selectedGuess && selectedGuessIndex !== null ? (
          <div data-cell-content-reveal-item="heuristic" data-cell-content-reveal-item-state={heuristicRevealed ? 'resolved' : 'scanning'} {...revealStageAttributes(heuristicRevealed)} style={{ display: 'block', ...revealStageStyle(heuristicRevealed) }}>
            <GuessReadout
              guess={selectedGuess}
              index={selectedGuessIndex}
              count={guesses.length}
              interactive={heuristicRevealed}
              onStep={(direction) => setGuessIndex((current) => (
                cycleIndex(current, guesses.length, direction)
              ))}
            />
          </div>
        ) : null}
        {selectedRole && selectedRoleIndex !== null ? (
          <div data-cell-content-reveal-item="role" data-cell-content-reveal-item-state={roleRevealed ? 'resolved' : 'scanning'} {...revealStageAttributes(roleRevealed)} style={{ display: 'block', ...revealStageStyle(roleRevealed) }}>
            <FacetReadout
              facet={selectedRole}
              index={selectedRoleIndex}
              count={roles.length}
              interactive={roleRevealed}
              onStep={(direction) => setRoleIndex((current) => (
                cycleIndex(current, roles.length, direction)
              ))}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
