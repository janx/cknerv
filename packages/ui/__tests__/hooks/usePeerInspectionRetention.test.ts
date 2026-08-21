import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '@cknerv/types';
import {
  PEER_LINK_LOST_HOLD_MS,
  usePeerInspectionRetention,
  type PeerInspectionRetentionInput,
} from '../../src/hooks/usePeerInspectionRetention';
import type { Vec3 } from '../../src/types';

const ALPHA = 'QmPeerAlpha0123456789';
const BETA = 'QmPeerBeta0123456789';

function peer(node_id: string, overrides: Partial<Peer> = {}): Peer {
  return {
    node_id,
    addr: '10.0.0.1:8115',
    direction: 'outbound',
    version: '0.201.0',
    latency_ms: 84,
    best_known: 16_204_887,
    connected_ms: 3_725_000,
    ...overrides,
  };
}

const AT: Vec3 = [3, 1, -2];
const MOVED: Vec3 = [5, 1, -4];

function retention(input: Partial<PeerInspectionRetentionInput> = {}) {
  const onExpire = vi.fn();
  const initial: PeerInspectionRetentionInput = {
    selectionKey: `peer:${ALPHA}`,
    peer: peer(ALPHA),
    position: AT,
    onExpire,
    ...input,
  };
  const view = renderHook(
    (props: PeerInspectionRetentionInput) => usePeerInspectionRetention(props),
    { initialProps: initial },
  );
  return { view, onExpire, initial };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePeerInspectionRetention', () => {
  it('passes the live peer through untouched while the link holds', () => {
    const { view, onExpire } = retention();
    expect(view.result.current.peer?.node_id).toBe(ALPHA);
    expect(view.result.current.position).toEqual(AT);
    expect(view.result.current.linkLost).toBe(false);
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS * 4);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('retains the last snapshot and anchor when the peer leaves peers[]', () => {
    const { view, initial } = retention();
    // Latency moved the node between polls: the anchor retained is the last
    // one the peer was actually drawn at, not the first.
    view.rerender({ ...initial, peer: peer(ALPHA, { latency_ms: 210 }), position: MOVED });
    view.rerender({ ...initial, peer: null, position: null });
    expect(view.result.current.peer?.node_id).toBe(ALPHA);
    expect(view.result.current.peer?.latency_ms).toBe(210);
    expect(view.result.current.position).toEqual(MOVED);
    expect(view.result.current.linkLost).toBe(true);
  });

  it('retires the selection once the epilogue has run its course', () => {
    const { view, onExpire, initial } = retention();
    view.rerender({ ...initial, peer: null, position: null });
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('cancels the epilogue when the peer reconnects', () => {
    const { view, onExpire, initial } = retention();
    view.rerender({ ...initial, peer: null, position: null });
    expect(view.result.current.linkLost).toBe(true);
    view.rerender({ ...initial, peer: peer(ALPHA), position: AT });
    expect(view.result.current.linkLost).toBe(false);
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('drops the snapshot and the timer when another entity is selected', () => {
    const { view, onExpire, initial } = retention();
    view.rerender({ ...initial, peer: null, position: null });
    view.rerender({
      ...initial,
      selectionKey: `peer:${BETA}`,
      peer: peer(BETA),
      position: MOVED,
    });
    expect(view.result.current.peer?.node_id).toBe(BETA);
    expect(view.result.current.linkLost).toBe(false);
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('reports nothing to inspect once the selection is cleared', () => {
    const { view, onExpire, initial } = retention();
    view.rerender({ ...initial, selectionKey: null, peer: null, position: null });
    expect(view.result.current.peer).toBeNull();
    expect(view.result.current.position).toBeNull();
    expect(view.result.current.linkLost).toBe(false);
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('holds nothing for a peer that was never observed alive', () => {
    const { view, onExpire } = retention({ peer: null, position: null });
    expect(view.result.current.peer).toBeNull();
    expect(view.result.current.linkLost).toBe(false);
    vi.advanceTimersByTime(PEER_LINK_LOST_HOLD_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
