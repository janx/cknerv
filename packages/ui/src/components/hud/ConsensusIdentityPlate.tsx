import type { CSSProperties } from 'react';
import type { CellConsensusIdentity } from '../../derives/cellConsensusIdentity.derive';
import { formatOutpoint } from './cellFormat';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const CYAN = HUD_COLORS.cyanWire;
const VIOLET = '#9D7BD8';
const GOLD = HUD_COLORS.orange;

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

function memoryRow(label: string, value: string, color: string, title?: string) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '58px minmax(0,1fr)', alignItems: 'baseline', minHeight: 17 }}>
      <span style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.8, fontWeight: 500, letterSpacing: 1.35, color: HUD_COLORS.dim }}>
        {label}
      </span>
      <span title={title} style={{ minWidth: 0, textAlign: 'right', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.3, color }}>
        {value}
      </span>
    </div>
  );
}

function IdentityBraid({ identity, reducedMotion }: {
  identity: CellConsensusIdentity;
  reducedMotion: boolean;
}) {
  const nibbles = fingerprintBody(identity.contentHash)
    .slice(0, 12)
    .split('')
    .map((hex) => Number.parseInt(hex, 16) || 0);
  const observed = identity.observedWrite !== null;
  const knotColor = observed ? GOLD : CYAN;

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

export default function ConsensusIdentityPlate({
  identity,
  reveal,
  statusText,
  statusColor,
  reducedMotion,
}: {
  identity: CellConsensusIdentity;
  reveal: number;
  statusText: string;
  statusColor: string;
  reducedMotion: boolean;
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

      <IdentityBraid identity={identity} reducedMotion={reducedMotion} />

      {memoryRow('ADDRESS', address, HUD_COLORS.ink, `${identity.txHash}#${identity.outPointIndex}`)}
      {memoryRow('CONTENT', fingerprint, CYAN, identity.contentHash)}
      {memoryRow('ANCHOR', `BLOCK #${identity.anchorBlock}`, '#C9F8FF')}

      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${CYAN}18` }}>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.3, letterSpacing: 0.45, color: statusColor, textShadow: `0 0 6px ${statusColor}55` }}>
          {statusText}
        </span>
        {observed ? (
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
