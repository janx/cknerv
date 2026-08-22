// The compositional gate: a snapshot, and the deltas that follow it.
//
// Snapshots carry the STAGE, not the retained map, so a client's records are
// staged-at-connect plus whatever the wire has handed it since. Everything
// downstream — the render set, the death rite, the nerve endpoints — assumes a
// staged member resolves to a record; nothing checks it, and a member that
// resolves to nothing is simply absent from the galaxy, silently, until a
// resync.
//
// `tests/fixtures/display_staged_records.json` is written by the server side
// of that claim (`staged_records_survive_a_snapshot_and_the_deltas_after_it`
// in `crates/cknerv-core/src/projection/cells.rs`): a real galaxy whose stage
// is smaller than its map, driven through the three ways a cell reaches the
// stage without a birth of its own — a spend staging its own endpoint, a
// vacancy refill after a GC, and a composed-mode transition. This file
// replays it through the REAL reducer and holds it to the claim.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Cell,
  CellGalaxySnapshot,
  RevisionedCellDelta,
} from '@cknerv/types';

import {
  applyRevisionedCellDeltas,
  fromCellsSnapshot,
  resolveDisplayCell,
  type CellGalaxyCache,
} from '../src/cellsReducer';

interface Witness {
  id: number;
  death_at_ms: number;
}

interface StagedRecordsFixture {
  revision: number;
  snapshot: CellGalaxySnapshot;
  deltas: RevisionedCellDelta[];
  final_revision: number;
  final_snapshot: CellGalaxySnapshot;
  witnesses: { corpse: Witness; refilled: Witness };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname, '..', '..', '..', 'tests', 'fixtures',
      'display_staged_records.json',
    ),
    'utf8',
  ),
) as StagedRecordsFixture;

/** The deltas grouped as the stream delivers them: one frame per revision,
 *  several deltas inside it. */
function byRevision(deltas: RevisionedCellDelta[]): RevisionedCellDelta[][] {
  const frames: RevisionedCellDelta[][] = [];
  for (const entry of deltas) {
    const last = frames[frames.length - 1];
    if (last !== undefined && last[0]?.revision === entry.revision) last.push(entry);
    else frames.push([entry]);
  }
  return frames;
}

/** What a client connecting at this snapshot is handed, by id. */
function handedOut(snapshot: CellGalaxySnapshot): Map<number, Cell> {
  const rows = new Map<number, Cell>();
  for (const cell of snapshot.cells) rows.set(cell.id, cell);
  for (const cell of snapshot.display?.residents ?? []) {
    if (!rows.has(cell.id)) rows.set(cell.id, cell);
  }
  return rows;
}

function unresolved(cache: CellGalaxyCache): number[] {
  return [...cache.displayMembers].filter(
    (id) => resolveDisplayCell(cache, id) === undefined,
  );
}

describe('a snapshot and the deltas that follow it', () => {
  it('never leaves a staged member without a record', () => {
    let cache = fromCellsSnapshot(fixture.revision, fixture.snapshot);
    expect(unresolved(cache)).toEqual([]);

    for (const frame of byRevision(fixture.deltas)) {
      cache = applyRevisionedCellDeltas(cache, frame);
      expect(
        unresolved(cache),
        `revision ${frame[0]?.revision}: staged members with no record`,
      ).toEqual([]);
    }
  });

  it('ends holding exactly what a client connecting at the end is handed', () => {
    let cache = fromCellsSnapshot(fixture.revision, fixture.snapshot);
    cache = applyRevisionedCellDeltas(cache, fixture.deltas);

    const fresh = fromCellsSnapshot(
      fixture.final_revision,
      fixture.final_snapshot,
    );
    expect([...cache.displayMembers].sort((a, b) => a - b))
      .toEqual([...fresh.displayMembers].sort((a, b) => a - b));

    const handed = handedOut(fixture.final_snapshot);
    for (const id of cache.displayMembers) {
      expect(resolveDisplayCell(cache, id), `member ${id}`)
        .toEqual(handed.get(id));
    }
  });

  it('shows the death of members it only ever learned of on their enter', () => {
    // Both witnesses are cells the connect snapshot never carried: one staged
    // by the very transaction that spent it, one staged alive by a vacancy
    // refill and spent blocks later. Neither is on stage at the end (the
    // corpse is reaped, the refilled seat is taken by composed mode), so hold
    // on to the last record each one had while it was still a member.
    const { corpse, refilled } = fixture.witnesses;
    const lastSeen = new Map<number, Cell | undefined>();
    let cache = fromCellsSnapshot(fixture.revision, fixture.snapshot);
    expect(resolveDisplayCell(cache, corpse.id)).toBeUndefined();
    expect(resolveDisplayCell(cache, refilled.id)).toBeUndefined();

    for (const frame of byRevision(fixture.deltas)) {
      cache = applyRevisionedCellDeltas(cache, frame);
      for (const witness of [corpse, refilled]) {
        if (cache.displayMembers.has(witness.id)) {
          lastSeen.set(witness.id, resolveDisplayCell(cache, witness.id));
        }
      }
    }

    for (const witness of [corpse, refilled]) {
      const record = lastSeen.get(witness.id);
      expect(record, `member ${witness.id} was never resolvable on stage`)
        .toBeDefined();
      expect(record?.death_at_ms, `member ${witness.id} kept rendering alive`)
        .toBe(witness.death_at_ms);
    }
  });
});
