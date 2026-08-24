import type { CSSProperties, ReactNode } from 'react';
import type {
  SemanticCellConsumption,
  TransactionSemanticRecord,
} from '@cknerv/types';
import type { CellCausalLens } from '../../derives/cellCausalLens.derive';
import { formatBlockRef, formatFeeShannons, midTruncate } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { PlateReadoutCaption, PlateReadoutRow } from './primitives';

const EXACT = HUD_COLORS.cyanInk;
const PARTIAL = HUD_COLORS.goldInk;
const UNAVAILABLE = HUD_COLORS.memory;

/** What the reader is actually looking at, in words nobody has to be taught.
 *  The module keeps its internal name — the derive, the props and every
 *  `data-causal-*` attribute still say causal lens — but the surface states
 *  the only thing this row has ever meant. */
const ORIGIN_TITLE = 'ORIGIN TX';
const ORIGIN_CAPTION = 'THE TRANSACTION THAT CREATED THIS CELL';
const CONSUMED_CAPTION = 'THE TRANSACTION THAT SPENT THIS CELL';

export interface CellCausalNavigationReadout {
  position: number;
  total: number;
  backCellId: number | null;
  forwardCellId: number | null;
  onBack: () => void;
  onForward: () => void;
}

const clampUnit = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
);

function shortHash(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** One vocabulary for what we hold, spelled in plain words and shared by both
 *  densities — the summary line and the full plate can no longer describe the
 *  same evidence in two different dialects. "Retained" is the whole claim: the
 *  creating link is still in memory, its endpoint anchors either all proved or
 *  some of them did not; an archived endpoint proved its anchor while its full
 *  record has already left the live cache. */
function statusMeta(lens: CellCausalLens): {
  color: string;
  label: string;
  provenance: 'observed' | 'identity-only';
  note: string;
} {
  const archived = [...lens.inputs, ...lens.outputs].filter((endpoint) => (
    endpoint.anchor !== null && endpoint.record === null
  )).length;
  if (lens.status === 'exact') {
    return {
      color: EXACT,
      label: 'EXACT',
      provenance: 'observed',
      note: archived > 0
        ? `LINK RETAINED · ALL ENDPOINTS PROVEN · ${archived} FROM ARCHIVE`
        : 'LINK RETAINED · ALL ENDPOINTS PROVEN',
    };
  }
  if (lens.status === 'partial') {
    const missing = lens.missingInputIds.length + lens.missingOutputIds.length;
    return {
      color: PARTIAL,
      label: 'PARTIAL',
      provenance: 'observed',
      note: `LINK RETAINED · ${missing} ANCHOR${missing === 1 ? '' : 'S'} MISSING`,
    };
  }
  return {
    color: UNAVAILABLE,
    label: 'UNAVAILABLE',
    provenance: 'identity-only',
    note: 'IDENTITY ONLY · ORIGIN LINK NO LONGER IN MEMORY',
  };
}

function endpointCount(
  retained: number,
  total: number | null,
  label: string,
): string {
  if (total === null) {
    return retained > 0 ? `${retained}+ ${label}` : `? ${label}`;
  }
  return `${retained}/${total} ${label}`;
}

/**
 * Compact provenance readout for the persistent selected-Cell causal lens.
 * It never promotes a derived spatial route to transaction evidence.
 */
export default function CellCausalLensReadout({
  lens,
  reveal = 1,
  navigation = null,
  compact = false,
  summary = false,
  transaction = null,
  consumed = null,
}: {
  lens: CellCausalLens;
  reveal?: number;
  navigation?: CellCausalNavigationReadout | null;
  compact?: boolean;
  /** One-glance origin evidence used by the no-scroll Cell detail satellite. */
  summary?: boolean;
  /**
   * Index evidence about the origin transaction ITSELF — what it paid and
   * what it burned. Absent until the source answers, and no row is reserved
   * for it: an origin block that grows a line is honest, one that holds two
   * empty rails for evidence nobody promised is not.
   */
  transaction?: TransactionSemanticRecord | null;
  /** The transaction that SPENT this cell, when the source named one. Printed
   *  only for a cell the projection already knows is dead. */
  consumed?: SemanticCellConsumption | null;
}) {
  const meta = statusMeta(lens);
  const anchoredInputs = lens.inputs.filter((item) => item.anchor).length;
  const anchoredOutputs = lens.outputs.filter((item) => item.anchor).length;
  const archivedEndpoints = [...lens.inputs, ...lens.outputs].filter(
    (item) => item.anchor !== null && item.record === null,
  ).length;
  const siblings = lens.outputCount === null
    ? null
    : Math.max(0, lens.outputCount - 1);
  const opacity = 0.68 + clampUnit(reveal) * 0.32;
  // The plain sentence under the title, carrying the transaction's shape when
  // the retained link states it. Outside the window there is no shape to
  // state — the caption says what the row is and stops there.
  const originCaption = lens.inputCount !== null && lens.outputCount !== null
    ? `${ORIGIN_CAPTION} · ${lens.inputCount} IN → ${lens.outputCount} OUT`
    : ORIGIN_CAPTION;
  const caption = (
    <div data-causal-origin-caption="true">
      <PlateReadoutCaption>{originCaption}</PlateReadoutCaption>
    </div>
  );
  const fee = transaction?.fee ?? null;
  const feeReadout = fee === null ? null : formatFeeShannons(fee);
  const feeTitle = fee === null ? undefined : `${fee} shannons`;
  const cycles = transaction?.cycles ?? null;
  const cyclesReadout = cycles !== null && cycles > 0
    ? cycles.toLocaleString('en-US')
    : null;
  // A spender is evidence about a DEAD cell. The projection's own lifecycle
  // decides that, never the enrichment record: a stale `consumed` under a
  // live cell would announce a death that has not happened.
  const spender = lens.selectedCell.death_at_ms !== null ? consumed : null;
  const originRow = (
    key: string,
    label: string,
    value: string,
    options: {
      title?: string;
      valueColor?: string;
      caption?: string;
    } = {},
  ): ReactNode => (
    <PlateReadoutRow
      key={key}
      accent={meta.color}
      label={label}
      value={value}
      valueColor={options.valueColor}
      valueSize={HUD_TYPE.label}
      title={options.title}
      rowAttributes={{ 'data-causal-origin-row': key }}
      valueAttributes={{ 'data-causal-origin-value': key }}
    >
      {options.caption
        ? <PlateReadoutCaption>{options.caption}</PlateReadoutCaption>
        : null}
    </PlateReadoutRow>
  );
  const originFacts = feeReadout || cyclesReadout || spender ? (
    <div
      data-causal-origin-facts="true"
      style={{ minWidth: 0, marginTop: 4, fontFamily: HUD_FONTS.mono }}
    >
      {feeReadout
        ? originRow('fee', 'FEE', feeReadout, { title: feeTitle })
        : null}
      {cyclesReadout
        ? originRow('cycles', 'CYCLES', cyclesReadout, {
          title: `${cycles} cycles executed`,
        })
        : null}
      {spender
        ? originRow(
          'consumed',
          'CONSUMED BY',
          typeof spender.block === 'number'
            ? `${midTruncate(spender.tx_hash, 12, 9)} · ${formatBlockRef(spender.block)}`
            : midTruncate(spender.tx_hash, 12, 9),
          {
            title: spender.tx_hash,
            // The third surface in the HUD that names this event, and the last
            // one still calling it a degradation. CELL MESH counts the deaths
            // in `ember` and the dossier's masthead flags the specimen in it;
            // the transaction that did the spending reads in the same tone. A
            // `valueColor` is ink and only ink, which is the one layer this
            // token is allowed on.
            valueColor: HUD_COLORS.ember,
            caption: CONSUMED_CAPTION,
          },
        )
        : null}
    </div>
  ) : null;
  const flowCell: CSSProperties = {
    minWidth: 0,
    fontFamily: HUD_FONTS.mono,
    fontSize: HUD_TYPE.label,
    letterSpacing: 0.35,
    whiteSpace: 'nowrap',
  };
  const navigationButton = (
    targetCellId: number | null,
    direction: 'back' | 'forward',
    onClick: () => void,
  ) => {
    const enabled = targetCellId !== null;
    const isBack = direction === 'back';
    return (
      <button
        type="button"
        disabled={!enabled}
        aria-label={enabled
          ? `${isBack ? 'Back to' : 'Forward to'} Cell ${targetCellId}`
          : `No ${direction} causal Cell`}
        title={enabled
          ? `${isBack ? 'Back' : 'Forward'} · Cell #${targetCellId}`
          : undefined}
        onClick={enabled ? onClick : undefined}
        style={{
          minWidth: 0,
          padding: '2px 4px',
          border: `1px solid ${enabled ? `${meta.color}42` : `${HUD_COLORS.dim}20`}`,
          background: enabled ? `${meta.color}0c` : 'transparent',
          color: enabled ? meta.color : HUD_COLORS.dim,
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.35,
          lineHeight: 1.2,
          textAlign: isBack ? 'left' : 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: enabled ? 'pointer' : 'default',
          opacity: enabled ? 0.9 : 0.34,
          pointerEvents: enabled ? 'auto' : 'none',
        }}
      >
        {isBack ? '‹ BACK' : 'FORWARD ›'}
        {enabled ? ` #${targetCellId}` : ''}
      </button>
    );
  };

  if (summary) {
    return (
      <div
        data-cell-causal-lens="true"
        data-causal-density="summary"
        data-causal-status={lens.status}
        data-causal-provenance={meta.provenance}
        data-causal-tx={lens.txHash}
        data-causal-block={lens.block}
        data-causal-link-seq={lens.linkSeq ?? ''}
        data-causal-inputs-anchored={anchoredInputs}
        data-causal-inputs-total={lens.inputCount ?? ''}
        data-causal-outputs-anchored={anchoredOutputs}
        data-causal-outputs-total={lens.outputCount ?? ''}
        data-causal-endpoints-archived={archivedEndpoints}
        style={{
          position: 'relative',
          marginTop: 5,
          padding: '5px 6px 5px',
          borderLeft: `1px solid ${meta.color}8f`,
          borderTop: `1px solid ${meta.color}22`,
          background: `linear-gradient(90deg,${meta.color}0d,transparent 88%)`,
          opacity,
        }}
      >
        {lens.status === 'unavailable' ? (
          // No retained link, no endpoint counts worth printing — the
          // identity-only situation is stated instead of a plate of "?"s.
          // It takes the SAME two-line shape as the resolved branch below:
          // title and standing on one line, the transaction on the next.
          // Crammed onto one line, the block ref was the span that lost the
          // shrink fight and ellipsized down to `#1…` — a reference to
          // nothing, printed where a block number belongs.
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, fontFamily: HUD_FONTS.mono }}>
              {/* A two-word title is one word for wrapping purposes: left to
                * shrink, `ORIGIN TX` breaks across two lines the moment the
                * plate is narrow enough that the row beside it wants room. */}
              <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', color: HUD_COLORS.cyanInk, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.label, fontWeight: 700, letterSpacing: 1.2 }}>
                {ORIGIN_TITLE}
              </span>
              <span
                data-causal-summary-note="true"
                style={{ marginLeft: 'auto', minWidth: 0, color: meta.color, fontSize: HUD_TYPE.micro, letterSpacing: 0.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {meta.note}
              </span>
            </div>
            {caption}
            <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0, marginTop: 3, fontFamily: HUD_FONTS.mono }}>
              <span title={lens.txHash} style={{ minWidth: 0, color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                TX {shortHash(lens.txHash)} · {formatBlockRef(lens.block)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
              {/* A two-word title is one word for wrapping purposes: left to
                * shrink, `ORIGIN TX` breaks across two lines the moment the
                * plate is narrow enough that the row beside it wants room. */}
              <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', color: HUD_COLORS.cyanInk, fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.label, fontWeight: 700, letterSpacing: 1.2 }}>
                {ORIGIN_TITLE}
              </span>
              <span style={{ color: meta.color, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.6 }}>
                {meta.label}
              </span>
              <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, whiteSpace: 'nowrap' }}>
                {endpointCount(anchoredInputs, lens.inputCount, 'IN')} · {endpointCount(anchoredOutputs, lens.outputCount, 'OUT')}
              </span>
            </div>
            {caption}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'baseline', gap: 7, marginTop: 3, fontFamily: HUD_FONTS.mono }}>
              <span title={lens.txHash} style={{ minWidth: 0, color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                TX {shortHash(lens.txHash)} · {formatBlockRef(lens.block)}
              </span>
              <span
                data-causal-summary-note="true"
                style={{ color: meta.color, fontSize: HUD_TYPE.micro, letterSpacing: 0.35, whiteSpace: 'nowrap' }}
              >
                {meta.note}
              </span>
            </div>
          </>
        )}
        {originFacts}
        {navigation && navigation.total > 1 ? (
          <div
            data-causal-navigation="true"
            data-causal-navigation-position={navigation.position}
            data-causal-navigation-total={navigation.total}
            data-causal-navigation-back={navigation.backCellId ?? ''}
            data-causal-navigation-forward={navigation.forwardCellId ?? ''}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 5, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${meta.color}18` }}
          >
            {navigationButton(navigation.backCellId, 'back', navigation.onBack)}
            <span style={{ color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, whiteSpace: 'nowrap' }}>
              PATH {navigation.position}/{navigation.total}
            </span>
            {navigationButton(
              navigation.forwardCellId,
              'forward',
              navigation.onForward,
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-cell-causal-lens="true"
      data-causal-status={lens.status}
      data-causal-provenance={meta.provenance}
      data-causal-tx={lens.txHash}
      data-causal-block={lens.block}
      data-causal-link-seq={lens.linkSeq ?? ''}
      data-causal-inputs-anchored={anchoredInputs}
      data-causal-inputs-total={lens.inputCount ?? ''}
      data-causal-outputs-anchored={anchoredOutputs}
      data-causal-outputs-total={lens.outputCount ?? ''}
      data-causal-endpoints-archived={archivedEndpoints}
      style={{
        position: 'relative',
        marginTop: compact ? 4 : 6,
        padding: compact ? '4px 5px 4px' : '6px 7px 5px',
        border: `1px solid ${meta.color}26`,
        borderLeftColor: `${meta.color}8f`,
        background: `linear-gradient(90deg, ${meta.color}0f, ${rgba(HUD_COLORS.stageGround, 0.22)} 58%, transparent)`,
        boxShadow: `inset 0 0 14px ${meta.color}08`,
        opacity,
      }}
    >
      <span style={{
        position: 'absolute',
        left: -1,
        top: -1,
        width: 7,
        height: 7,
        borderLeft: `1px solid ${meta.color}`,
        borderTop: `1px solid ${meta.color}`,
      }} />
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        fontFamily: HUD_FONTS.tech,
      }}>
        <span style={{
          color: HUD_COLORS.cyanInk,
          fontSize: HUD_TYPE.micro,
          fontWeight: 700,
          letterSpacing: 1.2,
        }}>
          {ORIGIN_TITLE}
        </span>
        <span style={{
          marginLeft: 'auto',
          color: meta.color,
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.6,
          textShadow: `0 0 6px ${meta.color}66`,
        }}>
          {meta.label}
        </span>
      </div>
      {caption}

      <div
        title={lens.txHash}
        style={{
          marginTop: compact ? 2 : 3,
          color: HUD_COLORS.ink,
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.label,
          letterSpacing: 0.35,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        TX {shortHash(lens.txHash)}
        <span style={{ color: HUD_COLORS.dim }}> · BLOCK {formatBlockRef(lens.block)}</span>
      </div>

      {lens.status === 'unavailable' ? (
        <div
          data-causal-unavailable-summary="true"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto',
            alignItems: 'baseline',
            gap: 8,
            marginTop: compact ? 4 : 6,
            paddingTop: compact ? 4 : 5,
            borderTop: `1px solid ${meta.color}20`,
            fontFamily: HUD_FONTS.mono,
          }}
        >
          <span style={{ minWidth: 0, color: meta.color, fontSize: HUD_TYPE.label, letterSpacing: 0.6 }}>
            {meta.note}
          </span>
          <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.label, letterSpacing: 0.35, whiteSpace: 'nowrap' }}>
            {endpointCount(anchoredInputs, lens.inputCount, 'INPUTS')} · {endpointCount(anchoredOutputs, lens.outputCount, 'OUTPUTS')}
          </span>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
            alignItems: 'center',
            gap: 5,
            marginTop: compact ? 2 : 4,
          }}>
            <span style={{ ...flowCell, color: HUD_COLORS.memoryInk }}>
              {endpointCount(anchoredInputs, lens.inputCount, 'INPUTS')}
            </span>
            {/* The two connectors are rules, so they are rules: `─` is a
                box-drawing character no face in `src/fonts` carries, and the
                pair of them were the only thing in this ornament holding the
                INPUTS and OUTPUTS counts together. A 1px line joins where a
                borrowed glyph's side bearings left a gap. The diamonds stay
                characters — they are read in sequence with TX. */}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                color: meta.color,
                fontFamily: HUD_FONTS.mono,
                fontSize: HUD_TYPE.label,
                textShadow: `0 0 6px ${meta.color}55`,
              }}
            >
              <span style={{ width: 6, height: 1, background: meta.color }} />
              ◇ TX ◆
              <span style={{ width: 6, height: 1, background: meta.color }} />
            </span>
            <span style={{ ...flowCell, color: HUD_COLORS.goldInk, textAlign: 'right' }}>
              {endpointCount(anchoredOutputs, lens.outputCount, 'OUTPUTS')}
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            marginTop: compact ? 2 : 4,
            paddingTop: compact ? 2 : 3,
            borderTop: `1px solid ${meta.color}18`,
            color: meta.color,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.35,
          }}>
            <span>{meta.note}</span>
            <span style={{
              marginLeft: 'auto',
              color: HUD_COLORS.dim,
              whiteSpace: 'nowrap',
            }}>
              {siblings === null
                ? '1 SELECTED · SIBLINGS ?'
                : `1 SELECTED · ${siblings} SIBLING${siblings === 1 ? '' : 'S'}`}
            </span>
          </div>
        </>
      )}
      {originFacts}

      {navigation && navigation.total > 1 ? (
        <div
          data-causal-navigation="true"
          data-causal-navigation-position={navigation.position}
          data-causal-navigation-total={navigation.total}
          data-causal-navigation-back={navigation.backCellId ?? ''}
          data-causal-navigation-forward={navigation.forwardCellId ?? ''}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
            alignItems: 'center',
            gap: 5,
            marginTop: compact ? 3 : 4,
            paddingTop: compact ? 3 : 4,
            borderTop: `1px solid ${meta.color}18`,
          }}
        >
          {navigationButton(
            navigation.backCellId,
            'back',
            navigation.onBack,
          )}
          <span style={{
            color: HUD_COLORS.dim,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.6,
            whiteSpace: 'nowrap',
          }}>
            PATH {navigation.position}/{navigation.total}
          </span>
          {navigationButton(
            navigation.forwardCellId,
            'forward',
            navigation.onForward,
          )}
        </div>
      ) : null}
    </div>
  );
}
