import { describe, expect, it } from 'vitest';
import type { Peer } from '@cknerv/types';
import {
  derivePeerLinkInstrument,
  formatLinkUptime,
  PEER_LINK_ACCENT_HEX,
  PEER_LINK_FACETS,
  peerSyncReadout,
  peerVersionMismatch,
  selectedPeerLinkAccent,
  type PeerLinkFacet,
} from '../../src/derives/peerLinkInstrument.derive';
import { latencyToRadius01, peerAngle, PEER_COLORS } from '../../src/derives/peers.derive';
import { PEER_NETWORK_HEX, PEER_NETWORK_PALETTE } from '../../src/visualPalette';
import { HUD_COLORS } from '../../src/components/hud/hudTheme';

const LOCAL_VERSION = '0.201.0';
const TIP = 16_204_887;

function peer(overrides: Partial<Peer> = {}): Peer {
  return {
    node_id: 'QmPeerAlpha0123456789',
    addr: '10.0.0.1:8115',
    direction: 'outbound',
    version: LOCAL_VERSION,
    latency_ms: 84,
    best_known: TIP,
    connected_ms: 3_725_000,
    ...overrides,
  };
}

function factValue(p: Peer, facet: PeerLinkFacet, tip = TIP): string {
  const row = derivePeerLinkInstrument(p, tip, LOCAL_VERSION).facts
    .find((fact) => fact.facet === facet);
  if (!row) throw new Error(`no ${facet} fact row`);
  return row.value;
}

describe('peerLinkInstrument derive — scene geometry', () => {
  it('delegates the compass ring to the scene mapping, mid ring when unknown', () => {
    expect(derivePeerLinkInstrument(peer(), TIP, LOCAL_VERSION).ring01)
      .toBe(latencyToRadius01(84));
    expect(derivePeerLinkInstrument(peer({ latency_ms: null }), TIP, LOCAL_VERSION).ring01)
      .toBe(0.5);
    expect(derivePeerLinkInstrument(peer({ latency_ms: undefined }), TIP, LOCAL_VERSION).ring01)
      .toBe(0.5);
    // The rim is the cap, not the largest sample seen.
    expect(derivePeerLinkInstrument(peer({ latency_ms: 4000 }), TIP, LOCAL_VERSION).ring01)
      .toBe(1);
  });

  it('reads the bearing from the same id hash the colony places nodes with', () => {
    const p = peer({ node_id: 'QmSomeOtherPeer' });
    expect(derivePeerLinkInstrument(p, TIP, LOCAL_VERSION).bearingRad)
      .toBe(peerAngle('QmSomeOtherPeer'));
  });

  it('marks unmeasured latency instead of printing the fallback as a reading', () => {
    const unknown = derivePeerLinkInstrument(peer({ latency_ms: null }), TIP, LOCAL_VERSION);
    expect(unknown.latencyKnown).toBe(false);
    expect(unknown.latencyMs).toBeNull();
    expect(unknown.ring01).toBe(0.5);

    const measured = derivePeerLinkInstrument(peer(), TIP, LOCAL_VERSION);
    expect(measured.latencyKnown).toBe(true);
    expect(measured.latencyMs).toBe(84);
  });
});

describe('peerLinkInstrument derive — sync tri-state', () => {
  it('reports at-tip only on an exact match', () => {
    const at = peerSyncReadout(TIP, TIP);
    expect(at.state).toBe('at-tip');
    expect(at.delta).toBe(0);
    expect(at.label).toBe('AT TIP');
    expect(at.color).toBe(HUD_COLORS.nominal);
  });

  it('reports behind with the block distance', () => {
    const behind = peerSyncReadout(TIP - 7, TIP);
    expect(behind.state).toBe('behind');
    expect(behind.delta).toBe(7);
    expect(behind.label).toBe('7 BEHIND');
    expect(behind.color).toBe(HUD_COLORS.caution);
  });

  it('surfaces AHEAD rather than collapsing it into AT TIP — it means WE lag', () => {
    // The rail panel this card replaces printed `AT TIP` for best_known >= tip,
    // hiding the one state that is actionable for the local node.
    const ahead = peerSyncReadout(TIP + 1, TIP);
    expect(ahead.state).toBe('ahead');
    expect(ahead.state).not.toBe('at-tip');
    expect(ahead.delta).toBe(1);
    expect(ahead.label).toBe('1 AHEAD');
    // Loudest of the three tiers.
    expect(ahead.color).toBe(HUD_COLORS.danger);
  });

  it('holds the boundary exactly at tip, tip+1 and tip-1', () => {
    expect(peerSyncReadout(TIP, TIP).state).toBe('at-tip');
    expect(peerSyncReadout(TIP + 1, TIP).state).toBe('ahead');
    expect(peerSyncReadout(TIP - 1, TIP).state).toBe('behind');
  });

  it('treats absent or non-finite heights as uncharted, never as at-tip', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const readout = peerSyncReadout(value, TIP);
      expect(readout.state).toBe('unknown');
      expect(readout.delta).toBe(0);
      expect(readout.label).toBe('UNCHARTED');
      expect(readout.color).toBe(HUD_COLORS.dim);
    }
  });

  it('groups large deltas the way the rest of the HUD prints heights', () => {
    expect(peerSyncReadout(TIP - 12_345, TIP).label).toBe('12,345 BEHIND');
  });
});

describe('peerLinkInstrument derive — accent agrees with the scene', () => {
  it('resolves the same hue the colony tints the measured node with', () => {
    const outbound = derivePeerLinkInstrument(peer(), TIP, LOCAL_VERSION);
    expect(outbound.colorKind).toBe('outbound');
    expect(outbound.accent).toBe(PEER_NETWORK_HEX.outbound);

    const inbound = derivePeerLinkInstrument(
      peer({ direction: 'inbound' }),
      TIP,
      LOCAL_VERSION,
    );
    expect(inbound.accent).toBe(PEER_NETWORK_HEX.inbound);
  });

  it('lets a version mismatch win over direction, in the scene violet', () => {
    const mismatched = derivePeerLinkInstrument(
      peer({ version: '0.114.0' }),
      TIP,
      LOCAL_VERSION,
    );
    expect(mismatched.versionMismatch).toBe(true);
    expect(mismatched.colorKind).toBe('version');
    expect(mismatched.accent).toBe(PEER_NETWORK_HEX.version);
    // Same constant the ColonyNodes float triple is converted from — one hue,
    // two encodings, never a second violet.
    expect(PEER_LINK_ACCENT_HEX.version).toBe(PEER_NETWORK_HEX.version);
    expect(PEER_COLORS.version).toBe(PEER_NETWORK_PALETTE.version);
  });

  it('calls an unreported version silence, not disagreement', () => {
    expect(peerVersionMismatch(peer({ version: '' }), LOCAL_VERSION)).toBe(false);
    expect(peerVersionMismatch(peer(), '')).toBe(false);
    expect(peerVersionMismatch(peer({ version: '0.114.0' }), LOCAL_VERSION)).toBe(true);
  });
});

describe('selectedPeerLinkAccent', () => {
  const base = { peer: peer(), tip: TIP, localVersion: LOCAL_VERSION };

  it('falls back to the base scene accent with no facet selected', () => {
    expect(selectedPeerLinkAccent(base, null)).toBe(PEER_NETWORK_HEX.outbound);
    expect(selectedPeerLinkAccent(base, 'addr')).toBe(PEER_NETWORK_HEX.outbound);
    expect(selectedPeerLinkAccent(base, 'direction')).toBe(PEER_NETWORK_HEX.outbound);
    expect(selectedPeerLinkAccent(base, 'uptime')).toBe(PEER_NETWORK_HEX.outbound);
  });

  it('tints the SYNC facet by the sync state', () => {
    expect(selectedPeerLinkAccent(base, 'sync')).toBe(HUD_COLORS.nominal);
    expect(selectedPeerLinkAccent(
      { ...base, peer: peer({ best_known: TIP - 5 }) },
      'sync',
    )).toBe(HUD_COLORS.caution);
    expect(selectedPeerLinkAccent(
      { ...base, peer: peer({ best_known: TIP + 5 }) },
      'sync',
    )).toBe(HUD_COLORS.danger);
    expect(selectedPeerLinkAccent(
      { ...base, peer: peer({ best_known: null }) },
      'sync',
    )).toBe(HUD_COLORS.dim);
  });

  it('tints the VERSION facet violet only on a real mismatch', () => {
    expect(selectedPeerLinkAccent(base, 'version')).toBe(HUD_COLORS.nominal);
    expect(selectedPeerLinkAccent(
      { ...base, peer: peer({ version: '0.114.0' }) },
      'version',
    )).toBe(PEER_NETWORK_HEX.version);
  });

  it('tints the PING facet with the instrument cyan', () => {
    expect(selectedPeerLinkAccent(base, 'ping')).toBe(HUD_COLORS.cyanWire);
  });

  it('keeps the mismatch violet as the base accent under a neutral facet', () => {
    const mismatched = { ...base, peer: peer({ version: '0.114.0' }) };
    expect(selectedPeerLinkAccent(mismatched, 'addr')).toBe(PEER_NETWORK_HEX.version);
    expect(selectedPeerLinkAccent(mismatched, null)).toBe(PEER_NETWORK_HEX.version);
  });
});

describe('peerLinkInstrument derive — LINE FACTS rows', () => {
  it('emits the six facts in reveal order', () => {
    const instrument = derivePeerLinkInstrument(peer(), TIP, LOCAL_VERSION);
    expect(instrument.facts.map((fact) => fact.facet)).toEqual([...PEER_LINK_FACETS]);
    expect(instrument.facts.map((fact) => fact.label)).toEqual([
      'ADDR', 'DIRECTION', 'VERSION', 'PING', 'SYNC', 'UPTIME',
    ]);
  });

  it('decodes a fully populated peer', () => {
    const p = peer({ best_known: TIP - 7 });
    expect(factValue(p, 'addr')).toBe('10.0.0.1:8115');
    expect(factValue(p, 'direction')).toBe('OUTBOUND');
    expect(factValue(p, 'version')).toBe(LOCAL_VERSION);
    expect(factValue(p, 'ping')).toBe('84 MS');
    expect(factValue(p, 'sync')).toBe('7 BEHIND');
    expect(factValue(p, 'uptime')).toBe('1h 2m');
  });

  it('prints an em dash for every value the node did not report', () => {
    const blank = peer({
      addr: '',
      version: '',
      latency_ms: null,
      best_known: null,
      connected_ms: 0,
    });
    expect(factValue(blank, 'addr')).toBe('—');
    expect(factValue(blank, 'version')).toBe('—');
    expect(factValue(blank, 'ping')).toBe('—');
    expect(factValue(blank, 'sync')).toBe('UNCHARTED');
    // Direction and uptime are always reported by the RPC.
    expect(factValue(blank, 'direction')).toBe('OUTBOUND');
    expect(factValue(blank, 'uptime')).toBe('0s');
  });

  it('colors the rows that carry their own semantics', () => {
    const rows = derivePeerLinkInstrument(
      peer({ direction: 'inbound', version: '0.114.0', best_known: TIP + 3 }),
      TIP,
      LOCAL_VERSION,
    ).facts;
    const by = (facet: PeerLinkFacet) => rows.find((row) => row.facet === facet);
    expect(by('direction')?.color).toBe(PEER_NETWORK_HEX.inbound);
    expect(by('version')?.color).toBe(PEER_NETWORK_HEX.version);
    expect(by('sync')?.color).toBe(HUD_COLORS.danger);
    expect(by('addr')?.color).toBeUndefined();
    expect(by('uptime')?.color).toBeUndefined();
  });

  it('shortens the peer id to the header form and keeps the badge', () => {
    const instrument = derivePeerLinkInstrument(
      peer({ node_id: 'QmABCDEFGHIJKLMNOP', direction: 'inbound' }),
      TIP,
      LOCAL_VERSION,
    );
    expect(instrument.id8).toBe('QmABCDEF');
    expect(instrument.directionBadge).toBe('IN');
    expect(derivePeerLinkInstrument(peer(), TIP, LOCAL_VERSION).directionBadge).toBe('OUT');
  });
});

describe('formatLinkUptime', () => {
  it('steps s → m → h without inventing precision', () => {
    expect(formatLinkUptime(0)).toBe('0s');
    expect(formatLinkUptime(9_400)).toBe('9s');
    expect(formatLinkUptime(59_999)).toBe('59s');
    expect(formatLinkUptime(60_000)).toBe('1m');
    expect(formatLinkUptime(3_599_000)).toBe('59m');
    expect(formatLinkUptime(3_600_000)).toBe('1h 0m');
    expect(formatLinkUptime(3_725_000)).toBe('1h 2m');
    expect(formatLinkUptime(11_520_000)).toBe('3h 12m');
  });

  it('never prints a negative or non-finite age', () => {
    expect(formatLinkUptime(-1)).toBe('0s');
    expect(formatLinkUptime(Number.NaN)).toBe('0s');
  });
});
