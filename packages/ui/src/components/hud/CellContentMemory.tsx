import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticContentGuess,
  SemanticContentSegment,
  SemanticFacet,
} from '@cknerv/types';
import {
  contentSegmentAtByte,
  deriveCellContentMemory,
} from '../../derives/cellContentMemory.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { formatSemanticAssetAmount } from './cellFormat';
import type { CellSemanticsPhase } from './CellSemanticsReadout';

const SEGMENT_COLORS = [
  '#71ECFF',
  '#C5A8FF',
  '#FFD27D',
  '#75F2AE',
  '#FF8FBD',
] as const;

function readableKind(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase();
}

function byteCount(
  observedBytes: number,
  totalBytes: number | null,
  complete: boolean,
): string {
  if (totalBytes === 0) return 'EMPTY';
  if (totalBytes === null) return `${observedBytes.toLocaleString()} B+ OBSERVED`;
  if (complete) return `${totalBytes.toLocaleString()} B · COMPLETE`;
  return `${observedBytes.toLocaleString()} / ${totalBytes.toLocaleString()} B`;
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

function analysisState({
  phase,
  record,
  source,
}: {
  phase?: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  source?: EnrichmentSourceStatus;
}): string {
  if (source?.status === 'stale' && record) return 'STALE PROOF';
  if (phase === 'loading') return 'RESOLVING';
  if (phase === 'waiting') return 'WAITING';
  if (phase === 'error') return 'ERROR';
  if (phase === 'unavailable') return 'NO RECORD';
  if (record?.content?.deterministic) return 'DETERMINISTIC';
  if ((record?.content?.heuristics.length ?? 0) > 0) return 'HEURISTIC';
  if (record) return 'RAW ONLY';
  return 'DIRECT';
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
    font: `8px ${HUD_FONTS.mono}`,
    lineHeight: 1,
    cursor: enabled ? 'pointer' : 'default',
    pointerEvents: enabled ? 'auto' : 'none',
    opacity: enabled ? 1 : 0.4,
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

function SegmentReadout({
  segment,
  index,
  count,
  onStep,
}: {
  segment: SemanticContentSegment;
  index: number;
  count: number;
  onStep: (direction: -1 | 1) => void;
}) {
  const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
  return (
    <div
      data-cell-content-segment={index}
      data-cell-content-segment-range={`${segment.start_byte}:${segment.end_byte}`}
      style={{ marginTop: 3, paddingTop: 3, borderTop: `1px solid ${rgba(color, 0.18)}` }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0,1fr) auto 18px', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <button
          type="button"
          aria-label="previous decoded segment"
          disabled={count <= 1}
          onClick={() => onStep(-1)}
          style={navButtonStyle(count > 1)}
        >
          ‹
        </button>
        <span style={{ color, fontSize: 6.2, letterSpacing: 0.42, whiteSpace: 'nowrap' }}>
          S{String(index + 1).padStart(2, '0')}/{String(count).padStart(2, '0')}
        </span>
        <span title={segment.label} style={{ minWidth: 0, color: '#DDFBFF', fontSize: 7.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {readableKind(segment.label)}
        </span>
        <span style={{ color: HUD_COLORS.dim, fontSize: 6.2, whiteSpace: 'nowrap' }}>
          [{segment.start_byte}..{segment.end_byte})
        </span>
        <button
          type="button"
          aria-label="next decoded segment"
          disabled={count <= 1}
          onClick={() => onStep(1)}
          style={navButtonStyle(count > 1)}
        >
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.9fr) minmax(0,1.1fr)', gap: 6, marginTop: 2, minWidth: 0 }}>
        <span title={segment.value} style={{ minWidth: 0, color, fontSize: 7.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {segment.value}
        </span>
        <span title={segment.meaning} style={{ minWidth: 0, color: HUD_COLORS.dim, fontSize: 6.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {segment.meaning}
        </span>
      </div>
    </div>
  );
}

function GuessReadout({
  guess,
  index,
  count,
  onStep,
}: {
  guess: SemanticContentGuess;
  index: number;
  count: number;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div
      data-cell-content-heuristic={index}
      style={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0,1fr) 18px', alignItems: 'baseline', gap: 4, minWidth: 0, marginTop: 3, paddingTop: 3, borderTop: `1px solid ${rgba(HUD_COLORS.caution, 0.15)}` }}
    >
      <button
        type="button"
        aria-label="previous heuristic"
        disabled={count <= 1}
        onClick={() => onStep(-1)}
        style={navButtonStyle(count > 1)}
      >
        ‹
      </button>
      <span style={{ color: HUD_COLORS.caution, fontSize: 6.2, whiteSpace: 'nowrap' }}>
        H{index + 1}/{count} · {guess.confidence.toUpperCase()}
      </span>
      <span title={`${guess.reason}${guess.mime_type ? ` · ${guess.mime_type}` : ''}${guess.value ? ` · ${guess.value}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: 6.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {readableKind(guess.kind)} · {guess.mime_type ?? guess.value ?? guess.reason}
      </span>
      <button
        type="button"
        aria-label="next heuristic"
        disabled={count <= 1}
        onClick={() => onStep(1)}
        style={navButtonStyle(count > 1)}
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
  onStep,
}: {
  facet: SemanticFacet;
  index: number;
  count: number;
  onStep: (direction: -1 | 1) => void;
}) {
  const first = facet.attributes[0];
  return (
    <div
      data-cell-content-role={index}
      style={{ display: 'grid', gridTemplateColumns: '18px auto minmax(0,1fr) 18px', alignItems: 'baseline', gap: 4, minWidth: 0, marginTop: 3 }}
    >
      <button
        type="button"
        aria-label="previous Cell role"
        disabled={count <= 1}
        onClick={() => onStep(-1)}
        style={navButtonStyle(count > 1)}
      >
        ‹
      </button>
      <span style={{ color: '#BFAAFF', fontSize: 6.2, whiteSpace: 'nowrap' }}>
        ROLE {index + 1}/{count}
      </span>
      <span title={`${facet.kind}${facet.state ? ` · ${facet.state}` : ''}${first ? ` · ${first.key}: ${first.value}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: 6.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {readableKind(facet.kind)}{facet.state ? ` · ${facet.state.toUpperCase()}` : ''}{first ? ` · ${readableKind(first.key)} ${first.value}${first.unit ? ` ${first.unit}` : ''}` : ''}
      </span>
      <button
        type="button"
        aria-label="next Cell role"
        disabled={count <= 1}
        onClick={() => onStep(1)}
        style={navButtonStyle(count > 1)}
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
  wide = false,
}: {
  dataHex: string;
  source?: EnrichmentSourceStatus;
  phase?: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
  wide?: boolean;
}) {
  const enhanced = Boolean(source && phase);
  const content = record?.content;
  const model = useMemo(
    () => deriveCellContentMemory(dataHex, content),
    [content, dataHex],
  );
  const segments = content?.deterministic?.segments ?? [];
  const guesses = content?.heuristics ?? [];
  const roles = record?.facets ?? [];
  const previewLimit = wide ? 32 : enhanced ? 24 : 28;
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [guessIndex, setGuessIndex] = useState(0);
  const [roleIndex, setRoleIndex] = useState(0);
  const [bytePage, setBytePage] = useState(0);
  const contentKey = `${record?.out_point.tx_hash ?? 'direct'}:${record?.out_point.index ?? 0}:${content?.deterministic?.kind ?? 'raw'}:${content?.data_hex ?? dataHex}`;
  const selectedSegmentIndex = segments.length === 0
    ? null
    : Math.min(segmentIndex, segments.length - 1);
  const selectedSegment = selectedSegmentIndex === null
    ? null
    : segments[selectedSegmentIndex];
  const selectedSegmentStart = selectedSegment?.start_byte ?? null;
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
    setSegmentIndex(0);
    setGuessIndex(0);
    setRoleIndex(0);
    setBytePage(0);
  }, [contentKey]);
  useEffect(() => {
    if (selectedSegmentStart !== null
      && selectedSegmentStart < model.observedBytes
    ) {
      setBytePage(Math.floor(selectedSegmentStart / previewLimit));
    }
  }, [model.observedBytes, previewLimit, selectedSegmentStart]);
  const assetAmount = record?.asset?.amount == null
    ? null
    : `${formatSemanticAssetAmount(
      record.asset.amount,
      record.asset.decimals,
    )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`;
  const bytePageCount = Math.max(1, Math.ceil(model.observedBytes / previewLimit));
  const selectedBytePage = Math.min(bytePage, bytePageCount - 1);
  const previewStart = selectedBytePage * previewLimit;
  const previewEnd = Math.min(model.observedBytes, previewStart + previewLimit);
  const previewBytes = model.bytes.slice(previewStart, previewEnd);
  const selectedRangeOutsidePreview = selectedSegment !== null
    && selectedSegment.start_byte >= model.observedBytes;
  const tone = analysisTone(source);
  const state = analysisState({ phase, record, source });
  const byteOrigin = model.origin === 'indexed' ? 'INDEX BYTES' : 'DIRECT BYTES';
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

  return (
    <section
      aria-label="Cell content memory"
      data-cell-content-memory="true"
      data-cell-content-memory-mode={enhanced ? 'indexed' : 'direct'}
      data-cell-content-byte-origin={model.origin}
      data-cell-content-complete={model.complete ? 'true' : 'false'}
      style={{
        minWidth: 0,
        marginTop: 4,
        padding: '4px 6px 5px',
        borderLeft: `1px solid ${rgba(enhanced ? tone : HUD_COLORS.cyanWire, 0.5)}`,
        borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.13)}`,
        background: `linear-gradient(100deg,${rgba(enhanced ? tone : HUD_COLORS.cyanWire, 0.065)},rgba(2,6,16,.28) 62%,transparent)`,
        fontFamily: HUD_FONTS.mono,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: '#D9FAFF', fontFamily: HUD_FONTS.tech, fontSize: 7.4, fontWeight: 700, letterSpacing: 1.05, whiteSpace: 'nowrap' }}>
          CELL CONTENT
        </span>
        <span style={{ marginLeft: 'auto', color: enhanced ? tone : HUD_COLORS.dim, fontSize: 6.3, letterSpacing: 0.62, whiteSpace: 'nowrap' }}>
          {enhanced ? `INDEX ANALYSIS · ${state}` : 'DIRECT NODE · RAW'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: wide && enhanced ? 'minmax(0,1.02fr) minmax(0,.98fr)' : 'minmax(0,1fr)', gap: wide && enhanced ? 8 : 3, minWidth: 0, marginTop: 3 }}>
        <div data-cell-content-raw="true" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ color: model.origin === 'indexed' ? tone : HUD_COLORS.cyanWire, fontSize: 6.2, letterSpacing: 0.52 }}>
              {byteOrigin}
            </span>
            {bytePageCount > 1 ? (
              <span data-cell-content-byte-window={`${previewStart}:${previewEnd}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: HUD_COLORS.dim, fontSize: 6.1 }}>
                <button
                  type="button"
                  aria-label="previous raw byte window"
                  disabled={selectedBytePage === 0}
                  onClick={() => setBytePage((current) => Math.max(0, current - 1))}
                  style={navButtonStyle(selectedBytePage > 0)}
                >
                  ‹
                </button>
                W {selectedBytePage + 1}/{bytePageCount}
                <button
                  type="button"
                  aria-label="next raw byte window"
                  disabled={selectedBytePage >= bytePageCount - 1}
                  onClick={() => setBytePage((current) => Math.min(bytePageCount - 1, current + 1))}
                  style={navButtonStyle(selectedBytePage < bytePageCount - 1)}
                >
                  ›
                </button>
              </span>
            ) : null}
            <span style={{ marginLeft: 'auto', color: model.complete ? HUD_COLORS.nominal : HUD_COLORS.caution, fontSize: 6.2, whiteSpace: 'nowrap' }}>
              {byteCount(model.observedBytes, model.totalBytes, model.complete)}
            </span>
          </div>
          {!model.valid ? (
            <div data-cell-content-invalid="true" style={{ marginTop: 4, color: HUD_COLORS.danger, fontSize: 7 }}>
              INVALID CONTENT HEX
            </div>
          ) : previewBytes.length === 0 ? (
            <div data-cell-content-empty="true" style={{ marginTop: 4, padding: '3px 5px', border: `1px solid ${rgba(HUD_COLORS.dim, 0.14)}`, color: HUD_COLORS.dim, fontSize: 6.8, letterSpacing: 0.7 }}>
              ∅ NO OUTPUT DATA
            </div>
          ) : (
            <>
              <div
                data-cell-content-bytes="true"
                title={content?.data_hex ?? dataHex}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '1px 3px', minWidth: 0, marginTop: 3, padding: '3px 4px', border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.12)}`, background: 'rgba(0,3,10,.38)' }}
              >
                {previewBytes.map((byte, localIndex) => {
                  const index = previewStart + localIndex;
                  const byteSegmentIndex = contentSegmentAtByte(
                    segments,
                    index,
                    selectedSegmentIndex,
                  );
                  const active = byteSegmentIndex !== null
                    && byteSegmentIndex === selectedSegmentIndex;
                  const color = byteSegmentIndex === null
                    ? HUD_COLORS.ink
                    : SEGMENT_COLORS[byteSegmentIndex % SEGMENT_COLORS.length];
                  return (
                    <span
                      key={index}
                      data-cell-content-byte={index}
                      data-cell-content-byte-segment={byteSegmentIndex ?? undefined}
                      style={{ color, fontSize: 6.6, lineHeight: 1.35, textShadow: active ? `0 0 5px ${color}` : undefined, opacity: selectedSegmentIndex === null || active || byteSegmentIndex === null ? 1 : 0.34 }}
                    >
                      {byte.toString(16).padStart(2, '0').toUpperCase()}
                    </span>
                  );
                })}
                {previewStart > 0 || previewEnd < model.observedBytes || model.truncated ? (
                  <span style={{ color: HUD_COLORS.dim, fontSize: 6.6 }}>…</span>
                ) : null}
              </div>
              <div data-cell-content-ascii="true" title={model.ascii} style={{ minWidth: 0, marginTop: 2, color: HUD_COLORS.dim, fontSize: 6.2, letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ASCII [{previewStart}..{previewEnd}) · {model.ascii.slice(previewStart, previewEnd)}
                {selectedRangeOutsidePreview ? ' · DECODE RANGE OUTSIDE RETAINED BYTES' : ''}
              </div>
            </>
          )}
        </div>

        {enhanced ? (
          <div data-cell-content-analysis="true" style={{ minWidth: 0, paddingTop: wide ? 0 : 2, borderTop: wide ? 0 : `1px solid ${rgba(tone, 0.13)}`, borderLeft: wide ? `1px solid ${rgba(tone, 0.16)}` : 0, paddingLeft: wide ? 7 : 0 }}>
            {record?.asset ? (
              <div data-cell-content-asset="true" title={record.asset.type_script_hash} style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0, color: HUD_COLORS.caution, fontSize: 6.5 }}>
                <span style={{ color: HUD_COLORS.dim }}>VALUE</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[record.asset.symbol, record.asset.name, record.asset.standard].filter(Boolean).join(' · ') || record.asset.type_script_hash}
                  {assetAmount ? ` · ${assetAmount}` : ''}
                </span>
              </div>
            ) : null}
            {content?.deterministic ? (
              <div data-cell-content-deterministic="true" style={{ minWidth: 0, marginTop: record?.asset ? 2 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                  <span style={{ color: HUD_COLORS.nominal, fontSize: 6.2, letterSpacing: 0.56, whiteSpace: 'nowrap' }}>
                    DECODE · {readableKind(content.deterministic.kind)}
                  </span>
                  <span title={content.deterministic.summary} style={{ minWidth: 0, marginLeft: 'auto', color: HUD_COLORS.ink, fontSize: 6.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {content.deterministic.summary}
                  </span>
                </div>
                {selectedSegment && selectedSegmentIndex !== null ? (
                  <SegmentReadout
                    segment={selectedSegment}
                    index={selectedSegmentIndex}
                    count={segments.length}
                    onStep={(direction) => setSegmentIndex((current) => (
                      cycleIndex(current, segments.length, direction)
                    ))}
                  />
                ) : null}
              </div>
            ) : statusMessage ? (
              <div title={statusMessage} style={{ marginTop: 2, color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: 6.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {statusMessage}
              </div>
            ) : (
              <div style={{ marginTop: 2, color: HUD_COLORS.dim, fontSize: 6.5 }}>
                NO DETERMINISTIC DECODE
              </div>
            )}
            {selectedGuess && selectedGuessIndex !== null ? (
              <GuessReadout
                guess={selectedGuess}
                index={selectedGuessIndex}
                count={guesses.length}
                onStep={(direction) => setGuessIndex((current) => (
                  cycleIndex(current, guesses.length, direction)
                ))}
              />
            ) : null}
            {selectedRole && selectedRoleIndex !== null ? (
              <FacetReadout
                facet={selectedRole}
                index={selectedRoleIndex}
                count={roles.length}
                onStep={(direction) => setRoleIndex((current) => (
                  cycleIndex(current, roles.length, direction)
                ))}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
