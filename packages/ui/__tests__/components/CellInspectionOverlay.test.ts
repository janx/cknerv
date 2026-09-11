import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetKind, Cell, CellSemanticRecord, LockKind } from '@cknerv/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  createCellInspectionHandles,
  selectedCellScanAccent,
  useCellInspectionDismiss,
} from '../../src/components/CellInspectionOverlay';
import {
  CONSTELLATION_WIDTH,
  invalidateConstellationFrame,
} from '../../src/components/hud/cellConstellationFrame';
import { settleCellConstellationCameraMotion } from '../../src/components/hud/cellConstellationCameraMotion';
import {
  cellScanFactAccent,
  type CellInspectionFacet,
} from '../../src/components/hud/CellDetailPanel';
import { CONTENT_BANDS } from '../../src/components/hud/cellFormat';
import { CELL_CARD_ACCENT, HUD_COLORS } from '../../src/components/hud/hudTheme';

const INSPECTION_OVERLAY_SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/CellInspectionOverlay.tsx',
), 'utf8');

const DETAIL_PANEL_SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/hud/CellDetailPanel.tsx',
), 'utf8');

const PANEL_HOST_SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/hud/ConstellationPanel.tsx',
), 'utf8');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function pointerEvent(
  type: string,
  target: Element,
  { button = 0, x = 0, y = 0 }: { button?: number; x?: number; y?: number } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'button', { value: button });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  target.dispatchEvent(event);
}

/** A click: pressed and released on the same spot. */
function pointerClick(target: Element, button = 0): void {
  pointerEvent('pointerdown', target, { button });
  pointerEvent('pointerup', target, { button });
}

/** A drag: pressed, travelled, released — what reframing the camera looks
 *  like from outside the card. */
function pointerDrag(target: Element, distance: number): void {
  pointerEvent('pointerdown', target);
  pointerEvent('pointermove', target, { x: distance });
  pointerEvent('pointerup', target, { x: distance });
}

const selected: Cell = {
  id: 7,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 100,
  tag: 'wallet',
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 0 },
  capacity: 10_000_000_000,
  data_hex: '0x01',
  data_bytes: 1,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_shape_seed: [1, 2],
  type_shape_seed: null,
  data_shape_seed: [3, 4],
  lock_kind: 'omnilock',
  asset_kind: 'xudt',
};

describe('the constellation the cell dialect places', () => {
  it('registers a room for every instrument and a lock to hold them', () => {
    // There is no `defaultSize` any more, and that is the point: a card had to
    // be placed by a guess until it was measured, because the guess and the
    // truth were one box. Each instrument is placed once its own content has
    // been measured, and a Cell holding no bytes never registers a reader.
    const handles = createCellInspectionHandles();

    expect(Object.keys(handles.panels).sort())
      .toEqual(['analysis', 'reader', 'specimen', 'trace']);
    for (const slot of Object.keys(handles.panels)) {
      expect(handles.panels[slot].present).toBe(false);
      expect(handles.panels[slot].height).toBe(0);
    }
    expect(handles.lock.quadrant).toEqual({});
  });

  it('states each instrument\'s own measure, and no card width at all', () => {
    // The three-rung width ladder went with the grid. What is left is one
    // number per instrument, and the register's is the one the HUD's rail
    // collapse is derived from.
    expect(CONSTELLATION_WIDTH.analysis).toBe(440);
    expect(CONSTELLATION_WIDTH.specimen).toBe(280);
    expect(CONSTELLATION_WIDTH.reader).toBe(408);
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('cellCardWidth');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('cellCardStandsOnHud');
  });

  it('tethers details without rebuilding a scanning apparatus around the Cell', () => {
    // The reticle and the leaders are DOM marks on the layer, not geometry in
    // the scene — the same ruling the connector has always been under.
    expect(INSPECTION_OVERLAY_SOURCE).toContain('CellReticle');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('CellConstellationLeaders');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('anchor-enter');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('dotEnterAnimation');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('scanPlaneRef');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<torusGeometry');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<cylinderGeometry');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('<octahedronGeometry');
  });

  it('clears the quadrant lock whenever the inspected cell changes', () => {
    // The hysteresis itself lives in the derive (which owns and tests it); the
    // overlay's one duty is to forget it when a different cell is selected, so
    // a fresh constellation chooses its rooms rather than inheriting them.
    expect(INSPECTION_OVERLAY_SOURCE).toContain('resetConstellationLock');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('[cell.id, handles]');
  });

  it('keeps the camera-motion window on the reused handle across a Cell key change', () => {
    const handles = createCellInspectionHandles();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1_000);
    const anchor = new THREE.Vector3();
    camera.position.z = 100;
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    expect(settleCellConstellationCameraMotion(
      handles.cameraMotion, camera, anchor, 1_080, 0,
    )).toBe(false);

    camera.position.x = 1;
    camera.updateMatrixWorld(true);
    expect(settleCellConstellationCameraMotion(
      handles.cameraMotion, camera, anchor, 1_080, 16,
    )).toBe(true);

    // Both keyed anchors receive the same App-owned channel. Geometry resets
    // for the new Cell, but the active damping window must not reset with it.
    invalidateConstellationFrame(handles);
    expect(settleCellConstellationCameraMotion(
      handles.cameraMotion, camera, anchor, 1_080, 32,
    )).toBe(true);
  });

  it('projects once, and reads no layout inside the frame', () => {
    // One anchor, one projection, four boxes — and every measurement the walk
    // spends came from a ResizeObserver on a panel's own content, never from
    // the frame loop.
    expect(INSPECTION_OVERLAY_SOURCE).toContain('advanceConstellationFrame');
    expect(INSPECTION_OVERLAY_SOURCE.match(/\.project\(camera\)/g)).toHaveLength(1);
    // The frame loop itself reads nothing: every `getBoundingClientRect` in the
    // file is inside the quarter-second dim sampler, which is allowed to trail
    // the frame and may not force a layout inside one.
    const frame = INSPECTION_OVERLAY_SOURCE.slice(
      INSPECTION_OVERLAY_SOURCE.indexOf('useFrame(('),
      INSPECTION_OVERLAY_SOURCE.indexOf('return <group ref={anchorRef}'),
    );
    expect(frame).not.toContain('getBoundingClientRect');
    expect(PANEL_HOST_SOURCE).toContain('new ResizeObserver');
    // …and the measurement is taken from the CONTENT, never from the host the
    // walk sized: observing the answer to compute the question is how a layout
    // oscillates.
    expect(PANEL_HOST_SOURCE).toContain('observer.observe(content)');
    expect(PANEL_HOST_SOURCE).not.toContain('observer.observe(host)');
  });

  it('keeps every instrument outside the Canvas container', () => {
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain('@react-three/drei');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('data-cell-inspection-layer');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('createCellInspectionHandles');
    expect(INSPECTION_OVERLAY_SOURCE).toContain('CellInspectionAnchor');
    expect(INSPECTION_OVERLAY_SOURCE).not.toContain(
      'onClick={(event) => event.stopPropagation()}',
    );
  });
});

  it('changes the detail connector accent with the focused Cell facet', () => {
    const resting = selectedCellScanAccent({ cell: selected }, null);
    const lock = selectedCellScanAccent({ cell: selected }, 'lock');
    const data = selectedCellScanAccent({ cell: selected }, 'data');

    expect(lock).not.toBe(resting);
    expect(data).not.toBe(lock);

    // WHERE (the state fact) used to be a third pin here, on the CELL's value rather than on
    // the facet: a live cell tethered `nominal` and a spent one `caution`, and
    // the assertion was that the line moved between them. It does not any
    // more, and that is the ruling rather than a regression — see the two
    // tests below. The line says WHICH FACT is open; the card says which state
    // the Cell is in, once, in the one vocabulary the house cut for it.
    expect(selectedCellScanAccent({ cell: { ...selected, death_at_ms: 1 } }, 'state'))
      .toBe(selectedCellScanAccent({ cell: selected }, 'state'));
    expect(selectedCellScanAccent({ cell: selected }, 'state'))
      .toBe(selectedCellScanAccent({ cell: selected }, 'capacity'));
  });

  it('nothing this table answers may be a rate the organism is spending', () => {
    // The general form of the finding, asked of the VALUES because the defect
    // cannot be seen in the source: what comes out of `cellScanFactAccent` is
    // a 1px rail, a selected wash, a 3px lamp and a leader line drawn across
    // the stage — four frames — and `hudTheme.ts` says of `ember` that it is
    // "never a panel accent, never a border, only ever a reading". So the
    // dossier could not simply take the tone CELL MESH counts deaths in, the
    // way the masthead and the CONSUMED BY row could; the frame and the
    // reading had to come apart, exactly as they already do for COMMIT one
    // layer over.
    //
    // Walked as a table rather than pinned as a hex, so the day a second
    // metabolic tone is cut beside `ember` this covers it without anybody
    // remembering the rule exists — the same bargain the durability ramp's
    // rung check makes in `hudDiscipline.test.ts`.
    const METABOLIC: Readonly<Record<string, string>> = { ember: HUD_COLORS.ember };
    const offenders: string[] = [];
    for (const lock_kind of LOCK_KINDS) {
      for (const asset_kind of ASSET_KINDS) {
        for (const death_at_ms of [null, 1]) {
          const cell: Cell = { ...selected, lock_kind, asset_kind, death_at_ms };
          for (const field of FACETS) {
            const accent = cellScanFactAccent(cell, field);
            for (const [name, tone] of Object.entries(METABOLIC)) {
              if (accent !== tone) continue;
              offenders.push(
                `${lock_kind}/${asset_kind}/${death_at_ms === null ? 'live' : 'spent'}/${field}`
                + ` frames in ${name} — a rail and a tether, in a reading's colour`,
              );
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a spent Cell is named in the metabolic tone where a reading is allowed', () => {
    // The other half, and the reason the test above is not simply a ban: the
    // event still has to be NAMED, and the register's WHERE word is one of the
    // three surfaces that names it — the only one on the card, since the
    // masthead's lamp gave the word up in round 3 and kept the light. It is `DECODE.state.color` rather than
    // `factAccent('state')` for the layer reason above, so it is read here as
    // source text — the one thing an oracle can ask of a value that is spelled
    // beside its frame.
    expect(DETAIL_PANEL_SOURCE).toContain([
      "      label: 'WHERE',",
      "      value: live ? 'LIVE' : 'SPENT',",
      '      color: live ? HUD_COLORS.nominal : HUD_COLORS.ember,',
    ].join('\n'));
  });


// ——— The one line that says "this card is about that Cell" ————————————————
//
// The tether kept its own copy of the fact-colour table and a resting branch
// that read the asset family. `asset_kind` is non-optional on the wire, so the
// `CELL_CARD_ACCENT` fallback beside it never ran: a plain CKB Cell — the
// commonest thing on the stage — tethered in `CONTENT_BANDS.consensus`, which
// is the peer plane's cyan, and a cell whose type script the local table cannot
// place tethered in `unlisted`, a near-black swatch that is invisible on the
// stage and completely invisible over the galaxy.

const FACETS: readonly CellInspectionFacet[] = [
  'lock', 'asset', 'state', 'born', 'capacity', 'data',
];
const ASSET_KINDS: readonly AssetKind[] = [
  'native', 'sudt', 'xudt', 'dao', 'spore', 'other', 'object', 'identity',
];
const LOCK_KINDS: readonly LockKind[] = [
  'sighash', 'multisig', 'acp', 'omnilock', 'other',
];

/** WCAG contrast against the stage's black. The tether is two pixels of line
 *  drawn straight onto it, so this is the only reading that says whether it
 *  survives — `#33424F` is a fifth of the way up in raw channel values and a
 *  twentieth of the way up in light. Written out here rather than imported:
 *  an oracle that borrows the implementation's own arithmetic cannot catch the
 *  implementation getting it wrong. */
function stageContrast(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (offset: number): number => {
    const value = parseInt(h.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return (luminance + 0.05) / 0.05;
}

/** A script the INDEX named, of a family the local table cannot place. */
const namedUnlisted: CellSemanticRecord = {
  out_point: selected.out_point,
  source: 'test',
  as_of: { block: 100, hash: `0x${'33'.repeat(32)}` },
  observed_at_block: 100,
  updated_at_ms: 0,
  type_script: {
    script_hash: `0x${'44'.repeat(32)}`,
    code_hash: `0x${'55'.repeat(32)}`,
    hash_type: 'type',
    args: '0x',
    name: 'Some Registry Script',
  },
  facets: [],
};

describe('the tether back to the Cell', () => {
  it('says what the Cell IS while no fact is open, for every asset family', () => {
    // Including `native`. A plain CKB cell used to resolve through the asset
    // table into the consensus cyan, so opening the commonest cell on stage drew
    // the tether in the colour that belongs to the peer plane.
    for (const asset_kind of ASSET_KINDS) {
      expect(selectedCellScanAccent({ cell: { ...selected, asset_kind } }, null))
        .toBe(CELL_CARD_ACCENT);
    }
    expect(CELL_CARD_ACCENT).not.toBe(CONTENT_BANDS.consensus);
  });

  it('says the same thing about a fact as the fact says about itself', () => {
    // One table, asked twice. The register's button and the tether are two
    // surfaces of one selection: the copy that used to live out here is how
    // COMMIT ended up orange on the line and cyan on the button.
    for (const field of FACETS) {
      const register = cellScanFactAccent(selected, field);
      const tether = selectedCellScanAccent({ cell: selected }, field);
      expect(tether).toBe(register);
    }
    // The declared house exception, kept: an anchor is a house fact, so both
    // surfaces wear chrome.
    expect(cellScanFactAccent(selected, 'born')).toBe(HUD_COLORS.orange);
    expect(selectedCellScanAccent({ cell: selected }, 'born'))
      .toBe(HUD_COLORS.orange);
  });

  it('reads a named script the way the register reads it', () => {
    const cell: Cell = { ...selected, asset_kind: 'other' };

    // Both through `scriptIdentityColor`: present, claiming no family colour it
    // has not earned. The tether used to answer `unlisted` for this.
    expect(cellScanFactAccent(cell, 'asset', namedUnlisted))
      .toBe(HUD_COLORS.ink);
    expect(selectedCellScanAccent(
      { cell, semanticRecord: namedUnlisted },
      'asset',
    )).toBe(HUD_COLORS.ink);
  });

  it('can never draw itself invisible', () => {
    // The whole branch space: every lock family, every asset family, both
    // states, every facet plus the resting frame. `unlisted` sits at 2.0 against
    // black and everything else clears 4.4, so a floor at 3 catches exactly the
    // one that cannot be seen.
    const dim: string[] = [];
    for (const lock_kind of LOCK_KINDS) {
      for (const asset_kind of ASSET_KINDS) {
        for (const death_at_ms of [null, 1]) {
          const cell: Cell = { ...selected, lock_kind, asset_kind, death_at_ms };
          for (const field of [...FACETS, null]) {
            const accent = selectedCellScanAccent({ cell }, field);
            if (stageContrast(accent) < 3) {
              dim.push(`${lock_kind}/${asset_kind}/${field} → ${accent}`);
            }
          }
        }
      }
    }

    expect(dim).toEqual([]);
    // And the pin that makes the sweep mean something: the value it used to
    // answer with really is below the floor.
    expect(stageContrast(CONTENT_BANDS.unlisted)).toBeLessThan(3);
  });
});

describe('Cell inspection dismissal', () => {
  it('keeps pointer interaction inside a detail window and closes outside it', () => {
    const boundary = document.createElement('div');
    const inside = document.createElement('button');
    const outside = document.createElement('button');
    boundary.append(inside);
    document.body.append(boundary, outside);
    const onDismiss = vi.fn();

    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));

    pointerClick(inside, 0);
    expect(onDismiss).not.toHaveBeenCalled();
    pointerClick(outside, 2);
    expect(onDismiss).not.toHaveBeenCalled();
    pointerClick(outside, 0);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('lets a drag outside reframe the view instead of closing the card', () => {
    const boundary = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(boundary, outside);
    const onDismiss = vi.fn();

    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));

    // The camera lies under every pixel outside the card, so an orbit drag
    // starts outside it by definition. Closing on the press would close the
    // card the moment the reader reached for the view behind it.
    pointerDrag(outside, 40);
    expect(onDismiss).not.toHaveBeenCalled();

    // A hand that is not quite still is still clicking.
    pointerEvent('pointerdown', outside);
    pointerEvent('pointermove', outside, { x: 2 });
    pointerEvent('pointerup', outside, { x: 2 });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('reads a drag by how far it got, not by where it ended', () => {
    const boundary = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(boundary, outside);
    const onDismiss = vi.fn();

    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));

    pointerEvent('pointerdown', outside);
    pointerEvent('pointermove', outside, { x: 60 });
    pointerEvent('pointerup', outside, { x: 0 });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('forgets a press the pointer never released', () => {
    const boundary = document.createElement('div');
    const inside = document.createElement('button');
    const outside = document.createElement('button');
    boundary.append(inside);
    document.body.append(boundary, outside);
    const onDismiss = vi.fn();

    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));

    // Cancelled by the browser (gesture stolen, window blurred): no release
    // may collect on it later.
    pointerEvent('pointerdown', outside);
    pointerEvent('pointercancel', outside);
    pointerEvent('pointerup', outside);
    expect(onDismiss).not.toHaveBeenCalled();

    // Released over the card it started outside of: the reader dragged INTO
    // the window, which is not a request to close it.
    pointerEvent('pointerdown', outside);
    pointerEvent('pointerup', inside);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes the complete details view on Escape', () => {
    const boundary = document.createElement('div');
    document.body.append(boundary);
    const onDismiss = vi.fn();
    renderHook(() => useCellInspectionDismiss({ current: boundary }, onDismiss));
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(escape);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
  });
});
