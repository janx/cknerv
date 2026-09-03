// The reader's supply line: which bytes DATA READER (SCAN·03) is drawing, and
// where they came from.
//
// The load-bearing sentence is the one about not asking. Ten thousand of the
// 10,356 staged Cells are already complete in the browser — a DAO marker is
// eight bytes, an sUDT amount sixteen, and the canonical `data_hex` carries a
// kilobyte before it truncates — so for all but 93 of them the reader opens on
// bytes that are already in hand and NOTHING leaves the browser. A hook that
// fetched first and compared afterwards would put ten thousand pointless round
// trips behind one click, and every one of them would answer with bytes the
// caller was holding when it asked.
//
// So the gate is a comparison the caller can already make: `held.length <
// totalBytes`. `totalBytes` is `Cell.data_bytes`, the chain's own statement of
// how long the output data is, and `held` is the PREFIX the snapshot or the
// index handed over. When the prefix is the whole payload there is no request
// and no phase to wait through; when it is not, the reader shows what it has
// as real rows and the rest as ghosts, and fills them in place.

import { useEffect, useMemo, useState } from 'react';
import type { OutPoint } from '@cknerv/types';
import {
  fetchCellOutputData,
  recallCellOutputData,
  rememberCellOutputData,
  type CellOutputData,
} from '@cknerv/cache';

import {
  READER_MIN_VISIBLE_ROWS,
  READER_VISIBLE_ROWS,
} from '../derives/cellDataReader.derive';

/**
 * Where the reader's bytes stand.
 *
 * `held` and `ready` are both COMPLETE payloads and differ only in provenance
 * — the browser was already holding all of it, or the node was asked and
 * answered. They are two phases rather than one because the status line says
 * which, and because only one of them can carry a data hash: a hash is
 * something the node computed and reported, and inventing one for a prefix
 * that happened to be the whole payload would put a number nobody checked
 * under the reader's caption.
 */
export type CellOutputDataPhase = 'held' | 'loading' | 'ready' | 'error';

export interface CellOutputDataInput {
  /** Which output's bytes. The identity of the request AND of the answer:
   *  an outpoint's data is written once and afterwards only spent, which is
   *  what lets the route promise `immutable` and the memo never invalidate. */
  outPoint: OutPoint;
  /** The reader is open. A closed reader asks for nothing, and an open one
   *  that closes aborts what it asked for. */
  enabled: boolean;
  /** The prefix already in the browser — `deriveCellContentMemory`'s bytes,
   *  which is the indexed 4 KiB where there is a record and the canonical
   *  1 KiB where there is not. */
  held: Uint8Array;
  /** `Cell.data_bytes`: the payload's true length, whatever we are holding of
   *  it. Every row count on the reader is derived from THIS. */
  totalBytes: number;
}

export interface CellOutputDataState {
  phase: CellOutputDataPhase;
  /** What to draw. The held prefix until the node answers, then all of it. */
  bytes: Uint8Array;
  /** How many of `totalBytes` are real. Rows past this are ghosts while the
   *  phase is `loading`, and there are none once it is not. */
  heldBytes: number;
  /** The node's own data hash, present only when the node answered. */
  dataHash: string | null;
  /** Whether the node found the output live, or reconstructed it from the
   *  transaction that created it. Null until the node has answered at all. */
  live: boolean | null;
  /** One line, on the failure that has one. */
  message: string | null;
}

/** The 404 said as a reading rather than as a status code.
 *
 *  Both of the route's 404s collapse into `null` at the client (M3), and both
 *  mean the same thing to somebody looking at a plate full of ghost rows:
 *  chain truth was consulted and there are no bytes to be had for this
 *  outpoint. It is an `error` phase rather than an empty `ready` because the
 *  reader is still holding a prefix it cannot complete, and saying `COMPLETE`
 *  over it would be the one lie this surface must not tell. */
const NO_BYTES_AT_THE_NODE = 'NO BYTES FOR THIS OUTPOINT AT THE NODE';

/** What the fetch came back with, tagged with the outpoint it was asked for.
 *  The tag is the second half of the abort: a controller stops a request the
 *  hook no longer wants, and the key stops an answer that resolved in the gap
 *  between the abort and the unmount from landing on a different Cell. */
interface CellOutputAnswer {
  key: string;
  data: CellOutputData | null;
  message: string | null;
}

function outPointIdentity(outPoint: OutPoint): string {
  return `${outPoint.tx_hash}:${outPoint.index}`;
}

/**
 * The bytes DATA READER draws, and the phase it draws them in.
 *
 * The state machine has exactly one branch that costs anything:
 *
 *   held.length ≥ totalBytes           → `held`, and no request is made
 *   otherwise, a session memo hit      → `ready`, synchronously, no ghosts
 *   otherwise                          → `loading` → `ready` | `error`
 *
 * The memo is consulted in render rather than in an effect on purpose. A
 * re-open of a Cell whose bytes this session already fetched must not flash a
 * frame of ghost rows before an effect replaces them — the card's whole
 * reveal discipline is that ink changes and geometry does not, and a phase
 * that goes `loading → ready` inside one click is a flicker, not a reading.
 * `recallCellOutputData` is a map lookup plus an LRU touch, which is idempotent
 * and cheap enough to sit inside a `useMemo`.
 */
export function useCellOutputData({
  outPoint,
  enabled,
  held,
  totalBytes,
}: CellOutputDataInput): CellOutputDataState {
  const { tx_hash: txHash, index } = outPoint;
  const key = `${txHash}:${index}`;
  // The whole payload is already here. Everything below is about the 93.
  const complete = held.length >= totalBytes;

  const memoised = useMemo(
    () => (complete || !enabled ? null : recallCellOutputData({ tx_hash: txHash, index })),
    [complete, enabled, index, txHash],
  );

  const [answer, setAnswer] = useState<CellOutputAnswer | null>(null);

  useEffect(() => {
    if (complete || !enabled || memoised !== null) return undefined;
    const controller = new AbortController();
    const asked = { tx_hash: txHash, index };
    void fetchCellOutputData(asked, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data === null) {
          setAnswer({ key, data: null, message: NO_BYTES_AT_THE_NODE });
          return;
        }
        // Remembered by the caller rather than by the client, which is the
        // shape M3 shipped and the peer sighting memo's precedent: WHEN to
        // spend memory on a synchronous re-open is a judgement about the
        // surface, and this surface is the one that benefits from it.
        rememberCellOutputData(asked, data);
        setAnswer({ key, data, message: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAnswer({
          key,
          data: null,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, [complete, enabled, index, key, memoised, txHash]);

  // An answer belongs to the outpoint it was asked for and to no other. The
  // abort above covers the common case; this covers the one it cannot — a
  // promise that had already resolved when the cleanup ran.
  const settled = answer !== null && answer.key === key ? answer : null;

  return useMemo<CellOutputDataState>(() => {
    if (complete) {
      return {
        phase: 'held',
        bytes: held,
        heldBytes: held.length,
        dataHash: null,
        live: null,
        message: null,
      };
    }
    const arrived = memoised ?? settled?.data ?? null;
    if (arrived !== null) {
      return {
        phase: 'ready',
        bytes: arrived.bytes,
        heldBytes: arrived.bytes.length,
        dataHash: arrived.dataHash,
        live: arrived.live,
        message: null,
      };
    }
    if (settled?.message != null) {
      return {
        phase: 'error',
        bytes: held,
        heldBytes: held.length,
        dataHash: null,
        live: null,
        message: settled.message,
      };
    }
    // Including the closed reader, which rests in the shape it will open in:
    // a payload we hold part of and have not asked about. Saying anything
    // else would mean the phase changed on the way to the first frame.
    return {
      phase: 'loading',
      bytes: held,
      heldBytes: held.length,
      dataHash: null,
      live: null,
      message: null,
    };
  }, [complete, held, memoised, settled]);
}

/**
 * Height allowance above the reader, in pixels.
 *
 * This is a VIEWPORT ALLOWANCE, not a measurement: it is what the card above
 * the reader is assumed to want on the app's default window, and the point of
 * the arithmetic it feeds is a reader that never pushes the card it belongs to
 * off the top of the screen. Measuring the card instead would tie the reader's
 * height to a layout pass that has not happened when the row mounts — and
 * would make the whole thing undrivable in a test, where nothing is laid out
 * at all.
 */
export const READER_VIEWPORT_ALLOWANCE_PX = 520;

/** Rows the reader shows on a window of `innerHeight`, between the floor and
 *  the full count. Pure, so the hook below and a test can ask the same
 *  question of a number nobody had to render. */
export function readerViewportRows(
  rowHeight: number,
  innerHeight: number,
): number {
  const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1;
  const available = (Number.isFinite(innerHeight) ? innerHeight : 0)
    - READER_VIEWPORT_ALLOWANCE_PX;
  const rows = Math.floor(available / height);
  return Math.max(READER_MIN_VISIBLE_ROWS, Math.min(READER_VISIBLE_ROWS, rows));
}

/**
 * How many rows of dump this window has room for.
 *
 * Read at mount and on `resize`, and nowhere else: the reader's height is
 * fixed for a given viewport, because a dump that reflowed while somebody was
 * reading a row would break the one rule every zone of this card keeps.
 */
export function useReaderViewportRows(rowHeight: number): number {
  const [rows, setRows] = useState(
    () => readerViewportRows(rowHeight, window.innerHeight),
  );
  useEffect(() => {
    const measure = () => setRows(readerViewportRows(rowHeight, window.innerHeight));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rowHeight]);
  return rows;
}
