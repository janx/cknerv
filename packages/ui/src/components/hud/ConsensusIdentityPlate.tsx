import type { CSSProperties } from 'react';
import type { CellConsensusIdentity } from '../../derives/cellConsensusIdentity.derive';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import type {
  ConsensusMemoryTraceReadout,
  ConsensusMemoryTraceSource,
  ConsensusMemoryTraceStage,
} from '../../nerve/consensusMemoryTrace';
import { formatOutpoint } from './cellFormat';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const CYAN = HUD_COLORS.cyanWire;
const VIOLET = '#9D7BD8';
const GOLD = HUD_COLORS.orange;
const LOCKED_GOLD = '#FFD7A1';

const MEMORY_READ_STAGES: ReadonlyArray<{
  stage: ConsensusMemoryTraceStage;
  code: string;
  label: string;
  color: string;
}> = [
  { stage: 'reading', code: '01', label: 'READING', color: CYAN },
  { stage: 'converging', code: '02', label: 'CONVERGING', color: VIOLET },
  { stage: 'locked', code: '03', label: 'LOCKED', color: LOCKED_GOLD },
];

function fingerprintBody(hash: string): string {
  return hash.replace(/^0x/i, '').toUpperCase();
}

/** Compact but stable readout: the full value remains available as a title. */
function fingerprintReadout(hash: string, reveal: number): string {
  const body = fingerprintBody(hash);
  const progress = Math.max(0, Math.min(1, reveal));
  if (progress >= 1) return `${body.slice(0, 16)} · ${body.slice(-10)}`;
  const visible = Math.floor(progress * 16);
  return `${body.slice(0, visible)}${'·'.repeat(16 - visible)} · ${'·'.repeat(10)}`;
}

function memoryRow({
  label,
  value,
  color,
  title,
  active,
  onActivate,
}: {
  label: string;
  value: string;
  color: string;
  title?: string;
  active?: boolean;
  onActivate?: () => void;
}) {
  const content = (
    <>
      <span style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.8, fontWeight: 500, letterSpacing: 1.35, color: HUD_COLORS.dim }}>
        {label}
      </span>
      <span title={title} style={{ minWidth: 0, textAlign: 'right', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.3, color }}>
        {value}
      </span>
    </>
  );
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '58px minmax(0,1fr)',
    alignItems: 'baseline',
    width: '100%',
    minHeight: 17,
    margin: 0,
    padding: 0,
    border: 0,
    borderRadius: 0,
    background: active ? `${CYAN}12` : 'transparent',
    boxShadow: active ? `inset 1px 0 0 ${CYAN}99` : undefined,
    cursor: onActivate ? 'pointer' : 'default',
    textAlign: 'left',
  };
  return onActivate ? (
    <button type="button" aria-label={`inspect ${label.toLowerCase()}`} onClick={onActivate} style={style}>
      {content}
    </button>
  ) : (
    <div style={style}>{content}</div>
  );
}

function IdentityBraid({ identity, reducedMotion, traceSelected }: {
  identity: CellConsensusIdentity;
  reducedMotion: boolean;
  traceSelected: boolean;
}) {
  const nibbles = fingerprintBody(identity.contentHash)
    .slice(0, 12)
    .split('')
    .map((hex) => Number.parseInt(hex, 16) || 0);
  const observed = identity.observedWrite !== null;
  const knotColor = traceSelected ? VIOLET : observed ? GOLD : CYAN;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 238 42"
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: 42, overflow: 'visible' }}
    >
      {/* Content-derived register marks: identity, not an activity meter. */}
      {nibbles.map((value, index) => {
        const x = 14 + index * 19;
        const height = 3 + (value / 15) * 8;
        return (
          <line
            key={index}
            x1={x}
            x2={x}
            y1={21 - height / 2}
            y2={21 + height / 2}
            stroke={index % 3 === 0 ? VIOLET : CYAN}
            strokeOpacity={0.12 + (value / 15) * 0.2}
            strokeWidth="1"
          />
        );
      })}

      {/* A's canonical grammar in miniature: independent cool paths agree at
          one content knot, then remain addressable as a persistent record. */}
      <path d="M4 7 C54 7 78 21 119 21 S184 35 234 35" fill="none" stroke={CYAN} strokeOpacity=".5" strokeWidth="1" />
      <path d="M4 21 C58 21 84 21 119 21 S180 21 234 21" fill="none" stroke="#C9F8FF" strokeOpacity=".34" strokeWidth=".8" />
      <path d="M4 35 C54 35 78 21 119 21 S184 7 234 7" fill="none" stroke={VIOLET} strokeOpacity=".48" strokeWidth="1" />
      <path d="M4 7 C54 7 78 21 119 21" fill="none" stroke={CYAN} strokeOpacity=".1" strokeWidth="5" />
      <path d="M4 35 C54 35 78 21 119 21" fill="none" stroke={VIOLET} strokeOpacity=".1" strokeWidth="5" />

      {[7, 21, 35].map((y, index) => (
        <circle key={`in-${y}`} cx="4" cy={y} r="1.6" fill={index === 2 ? VIOLET : CYAN} opacity=".7" />
      ))}
      {[7, 21, 35].map((y, index) => (
        <circle key={`out-${y}`} cx="234" cy={y} r="1.35" fill={index === 0 ? VIOLET : CYAN} opacity=".45" />
      ))}
      <circle cx="119" cy="21" r="7" fill={knotColor} opacity={observed ? '.08' : '.045'} />
      <circle
        cx="119"
        cy="21"
        r="2.4"
        fill={knotColor}
        opacity=".9"
        style={{ animation: reducedMotion ? undefined : 'cknerv-hud-breathe 1.8s ease-in-out infinite' }}
      />
      <path d="M119 15 L125 21 L119 27 L113 21 Z" fill="none" stroke={knotColor} strokeOpacity=".72" strokeWidth=".7" />
    </svg>
  );
}

function MemoryReadState({ readout, reducedMotion }: {
  readout: ConsensusMemoryTraceReadout;
  reducedMotion: boolean;
}) {
  const activeIndex = MEMORY_READ_STAGES.findIndex(
    ({ stage }) => stage === readout.stage,
  );
  const summary = readout.stage === 'reading'
    ? ['SCANNING RETAINED RECORD', `EVIDENCE 0/${readout.sourceCount}`]
    : readout.stage === 'converging'
      ? [
        'RECONCILING EVIDENCE',
        `ARRIVED ${readout.arrivedSourceCount}/${readout.sourceCount}`,
      ]
      : [
        'CONSENSUS RECORD RESOLVED',
        `VERIFIED ${readout.resolvedSourceCount}/${readout.sourceCount}`,
      ];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${readout.stage}; ${summary[1]}`}
      data-memory-read-state={readout.stage}
      data-memory-arrived={readout.arrivedSourceCount}
      data-memory-resolved={readout.resolvedSourceCount}
      style={{
        marginTop: 5,
        padding: '6px 0 5px',
        borderTop: `1px solid ${CYAN}22`,
        borderBottom: `1px solid ${LOCKED_GOLD}16`,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {MEMORY_READ_STAGES.map((item, index) => {
          const state = index < activeIndex
            ? 'past'
            : index === activeIndex
              ? 'active'
              : 'future';
          const on = state !== 'future';
          const active = state === 'active';
          return (
            <div
              key={item.stage}
              data-memory-stage={item.stage}
              data-memory-stage-state={state}
              style={{ minWidth: 0, color: item.color, opacity: active ? 1 : on ? 0.55 : 0.2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', height: 7 }}>
                <span style={{
                  flex: '0 0 auto',
                  width: active ? 5 : 3,
                  height: active ? 5 : 3,
                  border: `1px solid ${item.color}`,
                  background: on ? item.color : 'transparent',
                  boxShadow: active ? `0 0 7px ${item.color}` : undefined,
                  transform: 'rotate(45deg)',
                  transition: reducedMotion ? undefined : 'all 180ms ease',
                }} />
                {index < MEMORY_READ_STAGES.length - 1 ? (
                  <span style={{ flex: 1, height: 1, marginLeft: 4, background: item.color, opacity: on ? 0.45 : 0.16 }} />
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 6.8, opacity: 0.58 }}>
                  {item.code}
                </span>
                <span style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.1, fontWeight: active ? 700 : 500, letterSpacing: active ? 0.78 : 0.48 }}>
                  {item.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5, fontFamily: HUD_FONTS.mono, fontSize: 7.6, letterSpacing: 0.45 }}>
        <span style={{ color: MEMORY_READ_STAGES[activeIndex]?.color ?? CYAN }}>
          {summary[0]}
        </span>
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink }}>
          {summary[1]}
        </span>
      </div>
    </div>
  );
}

export default function ConsensusIdentityPlate({
  identity,
  reveal,
  statusText,
  statusColor,
  reducedMotion,
  focusedField,
  onInspectAddress,
  onInspectContent,
  onInspectAnchor,
  onRecallWrite,
  recallEnabled = true,
  traceSource = 'none',
  traceSelected = false,
  traceReadout = null,
}: {
  identity: CellConsensusIdentity;
  reveal: number;
  statusText: string;
  statusColor: string;
  reducedMotion: boolean;
  focusedField?: ConsensusBraidField | null;
  onInspectAddress?: () => void;
  onInspectContent?: () => void;
  onInspectAnchor?: () => void;
  onRecallWrite?: () => void;
  recallEnabled?: boolean;
  traceSource?: ConsensusMemoryTraceSource;
  traceSelected?: boolean;
  traceReadout?: ConsensusMemoryTraceReadout | null;
}) {
  const observed = identity.observedWrite;
  const lifecycleColor = identity.lifecycle === 'live'
    ? HUD_COLORS.nominal
    : HUD_COLORS.caution;
  const address = formatOutpoint(identity.txHash, identity.outPointIndex);
  const fingerprint = fingerprintReadout(identity.contentHash, reveal);
  const shell: CSSProperties = {
    position: 'relative',
    marginTop: 9,
    padding: '8px 9px 7px',
    overflow: 'hidden',
    borderTop: `1px solid ${CYAN}30`,
    borderBottom: `1px solid ${VIOLET}26`,
    backgroundColor: 'rgba(1,4,12,.84)',
    backgroundImage: `radial-gradient(circle at 50% 34%, ${CYAN}12 0, transparent 37%), linear-gradient(90deg, transparent, ${VIOLET}0b 48%, transparent)`,
    boxShadow: `inset 0 0 18px ${CYAN}08`,
  };

  return (
    <div data-consensus-memory="true" style={shell}>
      <span style={{ position: 'absolute', left: 0, top: 0, width: 8, height: 8, borderLeft: `1px solid ${CYAN}99`, borderTop: `1px solid ${CYAN}99` }} />
      <span style={{ position: 'absolute', right: 0, bottom: 0, width: 8, height: 8, borderRight: `1px solid ${VIOLET}88`, borderBottom: `1px solid ${VIOLET}88` }} />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: HUD_FONTS.tech, fontSize: 8.2, fontWeight: 700, letterSpacing: 1.45, color: '#C9F8FF' }}>
          CONSENSUS MEMORY
        </span>
        <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 8, color: VIOLET, opacity: 0.78 }}>
          共识记忆
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 0.8, color: lifecycleColor, textShadow: `0 0 6px ${lifecycleColor}66` }}>
          {identity.lifecycle === 'live' ? 'LIVE RECORD' : 'SPENT RECORD'}
        </span>
      </div>

      <IdentityBraid
        identity={identity}
        reducedMotion={reducedMotion}
        traceSelected={traceSelected}
      />

      {memoryRow({
        label: 'ADDRESS',
        value: address,
        color: HUD_COLORS.ink,
        title: `${identity.txHash}#${identity.outPointIndex}`,
        active: focusedField === 'state',
        onActivate: onInspectAddress,
      })}
      {memoryRow({
        label: 'CONTENT',
        value: fingerprint,
        color: CYAN,
        title: identity.contentHash,
        active: focusedField === 'data',
        onActivate: onInspectContent,
      })}
      {memoryRow({
        label: 'ANCHOR',
        value: `BLOCK #${identity.anchorBlock}`,
        color: '#C9F8FF',
        active: focusedField === 'born',
        onActivate: onInspectAnchor,
      })}

      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${CYAN}18` }}>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.3, letterSpacing: 0.45, color: statusColor, textShadow: `0 0 6px ${statusColor}55` }}>
          {statusText}
        </span>
        {traceSelected && traceReadout ? (
          <MemoryReadState readout={traceReadout} reducedMotion={reducedMotion} />
        ) : null}
        {observed && onRecallWrite ? (
          <button
            type="button"
            aria-label={traceSelected ? 'exit causal recall' : 'recall causal path'}
            data-write-observed="true"
            data-trace-available="true"
            data-trace-source={traceSource}
            data-trace-selected={traceSelected ? 'true' : 'false'}
            data-trace-state={traceSelected ? 'active' : 'ready'}
            data-trace-stage={traceSelected ? traceReadout?.stage ?? 'planning' : 'ready'}
            title={observed.txHash}
            onClick={onRecallWrite}
            disabled={!recallEnabled}
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', gap: '2px 8px', width: '100%', margin: '4px 0 0', padding: '3px 0 2px', border: 0, borderTop: `1px solid ${traceSelected ? VIOLET : GOLD}24`, background: traceSelected ? `${VIOLET}12` : 'transparent', fontFamily: HUD_FONTS.mono, fontSize: 8.1, letterSpacing: 0.35, color: traceSelected ? '#C7B9FF' : GOLD, textShadow: `0 0 6px ${traceSelected ? VIOLET : GOLD}55`, whiteSpace: 'nowrap', cursor: recallEnabled ? 'pointer' : 'default', textAlign: 'left', opacity: recallEnabled ? 1 : 0.62 }}
          >
            <span>WRITE OBSERVED</span>
            <span style={{ marginLeft: 'auto', color: '#FFD29A' }}>
              #{observed.block} · {observed.inputCount}→{observed.outputCount}
            </span>
            <span style={{ gridColumn: '1 / -1', color: traceSelected ? VIOLET : CYAN, letterSpacing: 0.8 }}>
              {!recallEnabled
                ? '↳ TRACE READY AFTER IDENTITY MAP'
                : traceSelected
                  ? traceReadout?.stage === 'reading'
                    ? '↳ READING RETAINED RECORD · EXIT'
                    : traceReadout?.stage === 'converging'
                      ? `↳ CONVERGING ${traceReadout.arrivedSourceCount}/${traceReadout.sourceCount} EVIDENCE · EXIT`
                      : traceReadout?.stage === 'locked'
                        ? '↳ CONSENSUS LOCKED · EXIT'
                        : '↳ MEMORY ROUTE PLANNING · EXIT'
                  : traceSource === 'witness'
                    ? '↳ RECALL LINEAGE WITNESS'
                    : traceSource === 'input'
                      ? '↳ RECALL CAUSAL PATH'
                      : '↳ RECALL RETAINED TRACE'}
            </span>
          </button>
        ) : observed ? (
          <div
            data-write-observed="true"
            title={observed.txHash}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, fontFamily: HUD_FONTS.mono, fontSize: 8.1, letterSpacing: 0.35, color: GOLD, textShadow: `0 0 6px ${GOLD}55`, whiteSpace: 'nowrap' }}
          >
            <span>WRITE OBSERVED</span>
            <span style={{ marginLeft: 'auto', color: '#FFD29A' }}>
              #{observed.block} · {observed.inputCount}→{observed.outputCount}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
