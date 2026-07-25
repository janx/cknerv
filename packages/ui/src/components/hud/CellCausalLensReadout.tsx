import type { CSSProperties } from 'react';
import type { CellCausalLens } from '../../derives/cellCausalLens.derive';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const EXACT = '#91F7FF';
const PARTIAL = '#FFD48C';
const UNAVAILABLE = '#9D7BD8';

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
  if (lens.status === 'exact') {
    return {
      color: EXACT,
      label: 'EXACT',
      provenance: 'observed',
      note: 'OBSERVED LINK · ALL ENDPOINT RECORDS RETAINED',
    };
  }
  if (lens.status === 'partial') {
    const missing = lens.missingInputIds.length + lens.missingOutputIds.length;
    return {
      color: PARTIAL,
      label: 'PARTIAL',
      provenance: 'observed',
      note: `OBSERVED LINK · ${missing} ENDPOINT${missing === 1 ? '' : 'S'} OUTSIDE LIVE CACHE`,
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
}: {
  lens: CellCausalLens;
  reveal?: number;
}) {
  const meta = statusMeta(lens);
  const retainedInputs = lens.inputs.filter((item) => item.record).length;
  const retainedOutputs = lens.outputs.filter((item) => item.record).length;
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

  return (
    <div
      data-cell-causal-lens="true"
      data-causal-status={lens.status}
      data-causal-provenance={meta.provenance}
      data-causal-tx={lens.txHash}
      data-causal-block={lens.block}
      data-causal-link-seq={lens.linkSeq ?? ''}
      data-causal-inputs-retained={retainedInputs}
      data-causal-inputs-total={lens.inputCount ?? ''}
      data-causal-outputs-retained={retainedOutputs}
      data-causal-outputs-total={lens.outputCount ?? ''}
      style={{
        position: 'relative',
        marginTop: 6,
        padding: '6px 7px 5px',
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
          fontSize: 7.8,
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
          marginTop: 3,
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

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
        alignItems: 'center',
        gap: 5,
        marginTop: 4,
      }}>
        <span style={{ ...flowCell, color: '#BBA8FF' }}>
          {endpointCount(retainedInputs, lens.inputCount, 'INPUTS')}
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
          {endpointCount(retainedOutputs, lens.outputCount, 'OUTPUTS')}
        </span>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        marginTop: 4,
        paddingTop: 3,
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
    </div>
  );
}
