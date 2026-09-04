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
  readerBelowRows,
  readerBesideRows,
  readerPlacement,
  type ReaderPlacement,
} from '../derives/cellDataReader.derive';
// The reader's own two numbers, from the reader itself. The only edge back
// from that module to this one is `import type { CellOutputDataPhase }`, which
// is erased before anything runs — so there is no cycle here, only a component
// stating its own geometry and a hook spending it.
import {
  READER_CHROME_PX,
  READER_ROW_HEIGHT_PX,
} from '../components/hud/CellDataReader';

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
 * Where the reader stands on THIS window: beside the analysis plate, or under
 * the card.
 *
 * Read at mount and on `resize`, and nowhere else. The placement is a fact
 * about the window rather than about the card, so it changes only when the
 * window does — and a reader that re-placed itself on any other event would be
 * a reader that moved out from under the byte somebody was reading.
 */
export function useReaderPlacement(): ReaderPlacement {
  const [placement, setPlacement] = useState<ReaderPlacement>(
    () => readerPlacement(window.innerWidth),
  );
  useEffect(() => {
    const measure = () => setPlacement(readerPlacement(window.innerWidth));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return placement;
}

/**
 * How many rows of dump this placement has room for.
 *
 * Beside the plate the answer comes from the PLATE — the reader is as tall as
 * it, so the plate's measured height less the reader's chrome is the dump's
 * budget, and the window never enters into it. Under the card the answer comes
 * from what is left of the window below the plate, which on a real dossier at
 * a real viewport is very little; that is the M5 finding, and the eight-row
 * floor is what the fallback settles at.
 *
 * The window is read at mount and on `resize`, and nowhere else, for the same
 * reason the placement is: the reader's height is fixed for a given viewport
 * because a dump that reflowed while somebody was reading a row would break
 * the one rule every zone of this card keeps. `plateHeightPx` is handed in by
 * the panel, which is the only thing holding a ref to the plate.
 */
export function useReaderRows(
  placement: ReaderPlacement,
  plateHeightPx: number,
): number {
  const [innerHeight, setInnerHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const measure = () => setInnerHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return placement === 'beside'
    ? readerBesideRows(plateHeightPx, READER_CHROME_PX, READER_ROW_HEIGHT_PX)
    : readerBelowRows(
      innerHeight,
      plateHeightPx,
      READER_CHROME_PX,
      READER_ROW_HEIGHT_PX,
    );
}
