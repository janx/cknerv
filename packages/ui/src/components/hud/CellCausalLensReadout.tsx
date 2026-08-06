import type { CSSProperties } from 'react';
import type { CellCausalLens } from '../../derives/cellCausalLens.derive';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const EXACT = '#91F7FF';
const PARTIAL = '#FFD48C';
const UNAVAILABLE = '#9D7BD8';

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
        ? `OBSERVED LINK · ${archived} ARCHIVED ANCHOR${archived === 1 ? '' : 'S'}`
        : 'OBSERVED LINK · ALL ENDPOINT RECORDS LIVE',
    };
  }
  if (lens.status === 'partial') {
    const missing = lens.missingInputIds.length + lens.missingOutputIds.length;
    return {
      color: PARTIAL,
      label: 'PARTIAL',
      provenance: 'observed',
      note: `OBSERVED LINK · ${missing} ENDPOINT ANCHOR${missing === 1 ? '' : 'S'} MISSING`,
    };
  }
  return {
    color: UNAVAILABLE,
    label: 'UNAVAILABLE',
    provenance: 'identity-only',
    note: 'IDENTITY ONLY · LINK OUTSIDE RETAINED WINDOW',
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
}: {
  lens: CellCausalLens;
  reveal?: number;
  navigation?: CellCausalNavigationReadout | null;
  compact?: boolean;
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
  const flowCell: CSSProperties = {
    minWidth: 0,
    fontFamily: HUD_FONTS.mono,
    fontSize: 7.1,
    letterSpacing: 0.42,
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
          fontSize: 6.4,
          letterSpacing: 0.32,
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
        background: `linear-gradient(90deg, ${meta.color}0f, rgba(1,4,12,.22) 58%, transparent)`,
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
          color: '#D9FAFF',
          fontSize: compact ? 7.3 : 7.8,
          fontWeight: 700,
          letterSpacing: 1.18,
        }}>
          CAUSAL LENS
        </span>
        <span style={{
          marginLeft: 'auto',
          color: meta.color,
          fontFamily: HUD_FONTS.mono,
          fontSize: 7,
          letterSpacing: 0.72,
          textShadow: `0 0 6px ${meta.color}66`,
        }}>
          {meta.label}
        </span>
      </div>

      <div
        title={lens.txHash}
        style={{
          marginTop: compact ? 2 : 3,
          color: HUD_COLORS.ink,
          fontFamily: HUD_FONTS.mono,
          fontSize: 7.1,
          letterSpacing: 0.28,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        TX {shortHash(lens.txHash)}
        <span style={{ color: HUD_COLORS.dim }}> · BLOCK #{lens.block}</span>
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
          <span style={{ minWidth: 0, color: meta.color, fontSize: 6.8, letterSpacing: 0.48 }}>
            IDENTITY ONLY · LINK NOT RETAINED
          </span>
          <span style={{ color: HUD_COLORS.dim, fontSize: 6.4, letterSpacing: 0.36, whiteSpace: 'nowrap' }}>
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
            <span style={{ ...flowCell, color: '#BBA8FF' }}>
              {endpointCount(anchoredInputs, lens.inputCount, 'INPUTS')}
            </span>
            <span
              aria-hidden="true"
              style={{
                color: meta.color,
                fontFamily: HUD_FONTS.mono,
                fontSize: 8,
                textShadow: `0 0 6px ${meta.color}55`,
              }}
            >
              ─◇ TX ◆─
            </span>
            <span style={{ ...flowCell, color: '#FFD29A', textAlign: 'right' }}>
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
            fontSize: 6.4,
            letterSpacing: 0.4,
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
            fontSize: 6.1,
            letterSpacing: 0.48,
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
