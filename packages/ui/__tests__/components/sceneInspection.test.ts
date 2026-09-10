import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import {
  INSPECTION_CARD_STYLE,
  useSceneInspectionExit,
  commitInspectionCardSize,
  commitInspectionFrame,
  createSceneInspectionHandles,
  detachInspectionCard,
  inspectionConnectorRestyleKey,
  inspectionFrameKey,
  resetInspectionPlacementLock,
  INSPECTOR_EDGE_PX,
  INSPECTOR_SAFE_TOP_PX,
  inspectionStageViewport,
  resolveStickyInspectorPlacement,
  sceneInspectorPlacement,
  type SceneInspectionHandles,
} from '../../src/components/sceneInspection';
import { HUD_MOTION } from '../../src/components/hud/hudTheme';

/** Every case below runs on the solver defaults: gap 42, edge 14, safe top
 *  104. With a 1200×800 viewport, an anchor at (300, 400) and a 500×300
 *  card, the vertical band is [minY −296, maxY 86] and centring solves to
 *  −150 — the geometry the existing Cell placement tests are written in. */
const BESIDE = {
  anchorX: 300,
  anchorY: 400,
  panelWidth: 500,
  panelHeight: 300,
  viewportWidth: 1200,
  viewportHeight: 800,
};

/** A 390-wide canvas leaves no beside room for a 300-wide card, so the
 *  solver falls back to the stacked family: below wins at anchor (195, 400)
 *  and the horizontal band is [minX −181, maxX −119], centring to −150. */
const STACKED = {
  anchorX: 195,
  anchorY: 400,
  panelWidth: 300,
  panelHeight: 300,
  viewportWidth: 390,
  viewportHeight: 800,
};

function makeHandles(): SceneInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: { width: 500, height: 300 },
    accent: '#ABCDEF',
    placementDataKey: 'probePlacement',
    connectorDataKey: 'probeConnectorDirection',
  });
}

describe('sceneInspectorPlacement preferred offsets', () => {
  it('uses an in-band preferredY verbatim instead of re-centring', () => {
    expect(sceneInspectorPlacement({ ...BESIDE, preferredY: -40 }))
      .toEqual({ family: 'beside', side: 'right', x: 42, y: -40 });
  });

  it('carries preferredY across a left flip unchanged', () => {
    expect(sceneInspectorPlacement({
      ...BESIDE,
      anchorX: 1000,
      preferredY: -40,
    })).toEqual({ family: 'beside', side: 'left', x: -542, y: -40 });
  });

  it('still clamps preferredY into the viewport band', () => {
    // Below the band: the card may not cross the bottom edge...
    expect(sceneInspectorPlacement({ ...BESIDE, preferredY: 200 }).y).toBe(86);
    // ...nor climb into the top HUD safe area.
    expect(sceneInspectorPlacement({ ...BESIDE, preferredY: -320 }).y)
      .toBe(-296);
  });

  it('lets minY win over preferredY when the band is inverted', () => {
    // A 700-tall card cannot satisfy both edges (minY −296 > maxY −314);
    // the safe top keeps priority exactly as it does for centring.
    expect(sceneInspectorPlacement({
      ...BESIDE,
      panelHeight: 700,
      preferredY: 0,
    }).y).toBe(-296);
  });

  it('uses an in-band preferredX verbatim in the stacked family', () => {
    expect(sceneInspectorPlacement({ ...STACKED, preferredX: -130 }))
      .toEqual({ family: 'stacked', side: 'below', x: -130, y: 42 });
  });

  it('still clamps preferredX into the stacked band', () => {
    expect(sceneInspectorPlacement({ ...STACKED, preferredX: -20 }).x)
      .toBe(-119);
    expect(sceneInspectorPlacement({ ...STACKED, preferredX: -300 }).x)
      .toBe(-181);
  });

  it('keeps the stacked y side-derived, deaf to preferredY', () => {
    // Below the anchor the card hangs from the gap and grows downward
    // already; a sticky vertical offset has nothing to add there.
    expect(sceneInspectorPlacement({ ...STACKED, preferredY: -100 }))
      .toEqual({ family: 'stacked', side: 'below', x: -150, y: 42 });
  });
});

/** What the local node's anchor does to the beside rule. Its icosahedron
 *  stands at (0, CHAIN_Y, 0) and the controls target at (0, CELLS_Y, 0), so it
 *  is ON the camera's orbit axis: it projects to the exact horizontal centre
 *  for every azimuth and elevation, where `roomRight` and `roomLeft` are equal
 *  to the last bit. The ulp of an 800-ish pixel coordinate is what the sides
 *  were being chosen by. */
const MIDLINE_X = 600;
const COORDINATE_ULP = 2.2737367544323206e-13;

describe('sceneInspectorPlacement side hysteresis', () => {
  it('picks the roomier side when the card has no side yet', () => {
    // The tie itself still resolves the way it always did — deterministically,
    // and only once per selection.
    expect(sceneInspectorPlacement({ ...BESIDE, anchorX: MIDLINE_X }).side)
      .toBe('right');
  });

  it('keeps a held side through an exact tie', () => {
    expect(sceneInspectorPlacement({
      ...BESIDE,
      anchorX: MIDLINE_X,
      heldSide: 'left',
    })).toEqual({ family: 'beside', side: 'left', x: -542, y: -150 });
  });

  it('keeps a held side through last-bit projection noise', () => {
    // Either sign: this is the noise itself, not a direction of travel.
    for (const noise of [COORDINATE_ULP, -COORDINATE_ULP, 3 * COORDINATE_ULP]) {
      expect(sceneInspectorPlacement({
        ...BESIDE,
        anchorX: MIDLINE_X + noise,
        heldSide: 'right',
      }).side).toBe('right');
      expect(sceneInspectorPlacement({
        ...BESIDE,
        anchorX: MIDLINE_X + noise,
        heldSide: 'left',
      }).side).toBe('left');
    }
  });

  it('keeps a held side while the rival leads by less than a quarter card', () => {
    // 2000 wide so both sides genuinely fit: roomRight 936, roomLeft 1036 —
    // a 100px lead under the 125px margin a 500-wide card buys.
    expect(sceneInspectorPlacement({
      ...BESIDE,
      viewportWidth: 2000,
      anchorX: 1050,
      heldSide: 'right',
    }).side).toBe('right');
  });

  it('gives way once the rival leads by more than a quarter card', () => {
    // Same geometry, anchor 50px further right: a 200px lead clears 125.
    expect(sceneInspectorPlacement({
      ...BESIDE,
      viewportWidth: 2000,
      anchorX: 1100,
      heldSide: 'right',
    }).side).toBe('left');
  });

  it('abandons a held side the card no longer fits on', () => {
    // No margin can keep a card somewhere it does not fit: roomRight is 186
    // against the 542 a 500-wide card needs.
    expect(sceneInspectorPlacement({
      ...BESIDE,
      anchorX: 1000,
      heldSide: 'right',
    }).side).toBe('left');
  });

  it('ignores a held side that belongs to the other family', () => {
    // A card driven onto a narrow canvas cannot be held 'right': the stacked
    // family names neither of the sides the beside one was solved in.
    expect(sceneInspectorPlacement({ ...STACKED, heldSide: 'right' }).side)
      .toBe('below');
  });

  it('holds the stacked family by its height instead', () => {
    // roomBelow 366, roomAbove 316: a 50px lead under the 75px margin a
    // 300-tall card buys, so a held 'above' keeps the card.
    expect(sceneInspectorPlacement({ ...STACKED, anchorY: 420, heldSide: 'above' }).side)
      .toBe('above');
    // ...and at the original anchor the lead is 90px, which clears it.
    expect(sceneInspectorPlacement({ ...STACKED, heldSide: 'above' }).side)
      .toBe('below');
  });
});

describe('sticky placement lock', () => {
  it('starts unlocked when the handles are created', () => {
    expect(makeHandles().placementLock)
      .toEqual({ family: null, y: null, x: null, side: null });
  });

  it('captures the first beside solve and holds its y while the card grows', () => {
    const handles = makeHandles();

    const opened = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(opened).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null, side: 'right' });

    // Enrichment arrives, the card grows 120px taller. Committing the new
    // measurement clears the frame signature but must not touch the lock...
    commitInspectionCardSize(handles, 500, 420);
    expect(handles.placementLock.y).toBe(-150);

    // ...so the re-place keeps the top edge where it opened (−150) instead
    // of re-centring to −210: all growth extends downward.
    const grown = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(grown).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
  });

  it('keeps the y lock across a left/right flip', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);

    const flipped = resolveStickyInspectorPlacement(handles, 1000, 400, 1200, 800);

    expect(flipped).toEqual({ family: 'beside', side: 'left', x: -542, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null, side: 'left' });
  });

  it('recaptures when the solver changes family', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);

    // The canvas narrows under the 500-wide card: the offsets now measure a
    // different free axis, so the beside lock yields to a fresh stacked one.
    const stacked = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);
    expect(stacked.side).toBe('below');
    expect(handles.placementLock)
      .toEqual({ family: 'stacked', y: null, x: stacked.x, side: 'below' });

    // And widening again recaptures a freshly centred beside offset.
    const beside = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(beside).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null, side: 'right' });
  });

  it('holds the stacked x while the card grows on a narrow canvas', () => {
    const handles = createSceneInspectionHandles({
      defaultSize: { width: 300, height: 300 },
      accent: '#ABCDEF',
      placementDataKey: 'probePlacement',
      connectorDataKey: 'probeConnectorDirection',
    });

    const opened = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);
    expect(opened).toEqual({ family: 'stacked', side: 'below', x: -150, y: 42 });
    expect(handles.placementLock)
      .toEqual({ family: 'stacked', y: null, x: -150, side: 'below' });

    commitInspectionCardSize(handles, 300, 500);
    const grown = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);

    // The taller card is squeezed up by the bottom edge, but its horizontal
    // offset — the stacked family's sticky axis — stays exactly captured.
    expect(grown).toEqual({ family: 'stacked', side: 'below', x: -150, y: -114 });
  });

  it('holds a midline card still while the projection jitters in the last bit', () => {
    const handles = makeHandles();

    // The card opens on the deterministic side of the tie...
    expect(resolveStickyInspectorPlacement(handles, MIDLINE_X, 400, 1200, 800).side)
      .toBe('right');

    // ...and every frame after it is float noise around the same midline. The
    // local node's card used to teleport `panelWidth + 2 * gap` across its
    // anchor on ~a third of the frames after any camera movement.
    for (const noise of [COORDINATE_ULP, -COORDINATE_ULP, 0, -3 * COORDINATE_ULP, 2 * COORDINATE_ULP]) {
      const frame = resolveStickyInspectorPlacement(
        handles, MIDLINE_X + noise, 400, 1200, 800,
      );
      expect(frame).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
    }
    expect(handles.placementLock.side).toBe('right');
  });

  it('still follows an entity that really crosses the midline', () => {
    const handles = makeHandles();
    expect(resolveStickyInspectorPlacement(handles, 900, 400, 2000, 800).side)
      .toBe('right');

    // Past the midline but inside the margin: the card stays put rather than
    // jumping the moment the anchor grazes centre.
    expect(resolveStickyInspectorPlacement(handles, 1050, 400, 2000, 800).side)
      .toBe('right');

    // Far enough past it that the other side is plainly the better home.
    expect(resolveStickyInspectorPlacement(handles, 1100, 400, 2000, 800).side)
      .toBe('left');
    expect(handles.placementLock.side).toBe('left');
  });

  it('clears on reset so the next selection centres itself afresh', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    commitInspectionCardSize(handles, 500, 420);

    resetInspectionPlacementLock(handles);
    expect(handles.placementLock)
      .toEqual({ family: null, y: null, x: null, side: null });

    // With no lock, the taller card centres to −210 and captures that.
    const fresh = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(fresh).toEqual({ family: 'beside', side: 'right', x: 42, y: -210 });
    expect(handles.placementLock.y).toBe(-210);
  });

  it('clears when the card detaches', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    const card = document.createElement('div');
    handles.card = card;

    detachInspectionCard(handles, card);

    expect(handles.card).toBeNull();
    expect(handles.placementLock)
      .toEqual({ family: null, y: null, x: null, side: null });
  });
});

describe('frame write gates', () => {
  it('ignores drift under half a pixel and admits drift over it', () => {
    const at = (x: number, y: number) => inspectionFrameKey(
      'right', x, y, 808, 668, '#71ECFF',
    );
    // The galaxy spins for hours: sub-pixel drift is what a tethered card
    // does EVERY frame, and it is not what a reader can see.
    expect(at(300, 400)).toBe(at(300.2, 400.2));
    expect(at(300, 400)).not.toBe(at(300.6, 400));
    expect(at(300, 400)).not.toBe(at(300, 400.6));
  });

  it('still admits a side, a size or an accent change', () => {
    const key = inspectionFrameKey('right', 300, 400, 808, 668, '#71ECFF');
    expect(inspectionFrameKey('left', 300, 400, 808, 668, '#71ECFF'))
      .not.toBe(key);
    expect(inspectionFrameKey('right', 300, 400, 808, 760, '#71ECFF'))
      .not.toBe(key);
    expect(inspectionFrameKey('right', 300, 400, 808, 668, '#FFB347'))
      .not.toBe(key);
  });

  it('keeps the connector appearance deaf to where the card sits', () => {
    // The restyle key takes no position at all: side, accent and card box are
    // the only things that change what the connector LOOKS like.
    const key = inspectionConnectorRestyleKey('right', '#71ECFF', 808, 668);
    expect(inspectionConnectorRestyleKey('right', '#71ECFF', 808.4, 668.4))
      .toBe(key);
    expect(inspectionConnectorRestyleKey('left', '#71ECFF', 808, 668))
      .not.toBe(key);
    expect(inspectionConnectorRestyleKey('right', '#FFB347', 808, 668))
      .not.toBe(key);
    expect(inspectionConnectorRestyleKey('right', '#71ECFF', 808, 760))
      .not.toBe(key);
  });
});

/** A card wired to real DOM, the way the frame loop finds it. */
function makeWiredHandles(): SceneInspectionHandles {
  const handles = makeHandles();
  handles.card = document.createElement('div');
  handles.leader = document.createElement('span');
  handles.leaderDot = document.createElement('span');
  handles.accent = '#71ECFF';
  return handles;
}

describe('commitInspectionFrame', () => {
  const RIGHT = { family: 'beside', side: 'right', x: 42, y: -150 } as const;

  it('writes the whole connector on the first frame', () => {
    const handles = makeWiredHandles();

    commitInspectionFrame(handles, RIGHT, 342, 250);

    expect(handles.card?.style.transform)
      .toBe('translate3d(342px, 250px, 0)');
    expect(handles.card?.dataset.probePlacement).toBe('right');
    expect(handles.leader?.dataset.probeConnectorDirection).toBe('right');
    expect(handles.leader?.style.width).toBe('42px');
    expect(handles.leader?.style.height).toBe('2px');
    expect(handles.leader?.style.left).toBe('-42px');
    expect(handles.leader?.style.background)
      .toContain('linear-gradient(90deg,');
    expect(handles.leader?.style.boxShadow).toBe('0 0 7px #71ECFF55');
    expect(handles.leaderDot?.style.borderColor).toBe('rgb(113, 236, 255)');
    expect(handles.leaderDot?.style.boxShadow).toBe('0 0 9px #71ECFF99');
    // The free coordinate: 15px clear of the card corner, else -placement.y.
    // It is a DISPLACEMENT from a corner pinned at zero, never an edge offset
    // — the frame loop may not write a layout property.
    expect(handles.leader?.style.top).toBe('0px');
    expect(handles.leaderDot?.style.top).toBe('0px');
    expect(handles.leader?.style.translate).toBe('0px 150px');
    expect(handles.leaderDot?.style.translate).toBe('0px 146px');
  });

  it('re-places a drifting card without repainting its connector', () => {
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);

    // Scribble over everything the appearance pass owns. A drift frame must
    // not restore any of it — that is the whole point of the second gate.
    const leader = handles.leader as HTMLSpanElement;
    const dot = handles.leaderDot as HTMLSpanElement;
    leader.style.background = 'none';
    leader.style.boxShadow = 'none';
    leader.style.width = '0px';
    dot.style.borderColor = 'transparent';

    commitInspectionFrame(handles, { family: 'beside', side: 'right', x: 42, y: -158 }, 349, 242);

    expect(leader.style.background).toBe('none');
    expect(leader.style.boxShadow).toBe('none');
    expect(leader.style.width).toBe('0px');
    expect(dot.style.borderColor).toBe('transparent');
    // ...while the two things that actually moved did move.
    expect(handles.card?.style.transform)
      .toBe('translate3d(349px, 242px, 0)');
    expect(leader.style.translate).toBe('0px 158px');
    expect(dot.style.translate).toBe('0px 154px');
    // …and moved by nothing that costs a layout: the pin did not budge.
    expect(leader.style.top).toBe('0px');
    expect(dot.style.top).toBe('0px');
  });

  it('skips the frame entirely when the drift is sub-quantum', () => {
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);
    (handles.card as HTMLDivElement).style.transform = 'scribble';

    commitInspectionFrame(handles, RIGHT, 342.2, 250.2);

    expect(handles.card?.style.transform).toBe('scribble');
  });

  it('repaints the connector when the side flips', () => {
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);

    commitInspectionFrame(handles, { family: 'beside', side: 'left', x: -542, y: -150 }, 200, 250);

    const leader = handles.leader as HTMLSpanElement;
    // The right-hand edge offsets are cleared, not left behind to fight the
    // new ones: a flipped connector hangs off one side only.
    expect(leader.style.left).toBe('');
    expect(leader.style.right).toBe('-42px');
    expect((handles.leaderDot as HTMLSpanElement).style.left).toBe('');
    expect((handles.leaderDot as HTMLSpanElement).style.right).toBe('-46px');
    expect(handles.card?.dataset.probePlacement).toBe('left');
  });

  it('repaints the connector when the accent changes under a still card', () => {
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);

    handles.accent = '#FFB347';
    commitInspectionFrame(handles, RIGHT, 342, 250);

    expect(handles.leader?.style.boxShadow).toBe('0 0 7px #FFB34755');
    expect(handles.leaderDot?.style.borderColor).toBe('rgb(255, 179, 71)');
  });

  it('repaints a connector that a re-measure or a detach invalidated', () => {
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);
    (handles.leader as HTMLSpanElement).style.background = 'none';

    // A fresh card element inherits none of the connector's appearance, and
    // both invalidation paths clear the signature that would have vouched
    // for it.
    commitInspectionCardSize(handles, 500, 300);
    expect(handles.restyleKey).toBe('');
    commitInspectionFrame(handles, RIGHT, 342, 250);
    expect(handles.leader?.style.background).toContain('linear-gradient(90deg,');

    detachInspectionCard(handles, handles.card as HTMLDivElement);
    expect(handles.restyleKey).toBe('');
  });

  it('slides the connector along the card edge in the stacked family', () => {
    const handles = makeWiredHandles();
    commitInspectionCardSize(handles, 300, 300);

    commitInspectionFrame(handles, { family: 'stacked', side: 'below', x: -150, y: 42 }, 45, 442);
    expect(handles.leader?.style.top).toBe('-42px');
    expect(handles.leader?.style.left).toBe('0px');
    expect(handles.leader?.style.translate).toBe('150px 0px');
    expect(handles.leaderDot?.style.translate).toBe('146px 0px');

    (handles.leader as HTMLSpanElement).style.background = 'none';
    commitInspectionFrame(handles, { family: 'stacked', side: 'below', x: -130, y: 42 }, 65, 442);
    expect(handles.leader?.style.translate).toBe('130px 0px');
    expect(handles.leader?.style.left).toBe('0px');
    expect(handles.leader?.style.background).toBe('none');
  });

  it('writes no layout property on the frame path', () => {
    // The card moves by transform and the connector by translate; a `top` or
    // a `left` here would put a positioned layout on every frame of an orbit
    // for as long as a card is open. The pins are the appearance pass's.
    const handles = makeWiredHandles();
    commitInspectionFrame(handles, RIGHT, 342, 250);
    const leader = handles.leader as HTMLSpanElement;
    const dot = handles.leaderDot as HTMLSpanElement;
    const pinned = [
      leader.style.left, leader.style.right, leader.style.top, leader.style.bottom,
      dot.style.left, dot.style.right, dot.style.top, dot.style.bottom,
    ];

    for (let step = 1; step <= 6; step += 1) {
      commitInspectionFrame(
        handles, { family: 'beside', side: 'right', x: 42, y: -150 - step * 9 }, 342 + step * 9, 250,
      );
    }

    expect([
      leader.style.left, leader.style.right, leader.style.top, leader.style.bottom,
      dot.style.left, dot.style.right, dot.style.top, dot.style.bottom,
    ]).toEqual(pinned);
    expect(leader.style.translate).toBe('0px 204px');
    expect(dot.style.translate).toBe('0px 200px');
  });
});

/**
 * The HUD as the solver now sees it. A rail is a box in viewport coordinates
 * and nothing more; what makes these the interesting boxes is that they are
 * the shape the real HUD has — two fixed columns down the sides with a hole
 * between them, and the card measured against a hole rather than a viewport.
 *
 * On the 1,400-wide stage below the band a 400×300 card occupies is
 * [250, 550] (anchor y 400, centred, clamped by nothing), so a rail that runs
 * the full height crosses it and one that starts at 700 does not.
 */
const OBSTRUCTED = {
  anchorX: 700,
  anchorY: 400,
  panelWidth: 400,
  panelHeight: 300,
  viewportWidth: 1400,
  viewportHeight: 900,
};
/** Full-height left column, the shape CKB·01's cluster has. */
const LEFT_RAIL = { left: 0, top: 0, right: 300, bottom: 900 };
/** Full-height right column, the shape CELL·03 + PEER·02 have. */
const RIGHT_RAIL = { left: 1100, top: 0, right: 1400, bottom: 900 };
/** Same column, but only the bottom third of it — DAO·05 sitting low on a tall
 *  rail, level with nothing the card occupies. */
const LOW_LEFT_PANEL = { left: 0, top: 700, right: 300, bottom: 900 };
/** A panel standing clear of the left edge, so a card pushed off it still has
 *  somewhere to land — the geometry that makes a lead measurable rather than
 *  binary. */
const NEAR_LEFT_PANEL = { left: 900, top: 0, right: 1000, bottom: 900 };

describe('sceneInspectorPlacement obstacles', () => {
  it('places exactly as before when it is given none', () => {
    // The equivalence the whole change rests on: with an empty reading the
    // settled position is `gap` from the anchor and the slack is
    // `room − panelWidth − gap`, so every fit test, every roomier comparison
    // and every hysteresis lead is the arithmetic this solver already had.
    expect(sceneInspectorPlacement({ ...OBSTRUCTED, obstacles: [] }))
      .toEqual(sceneInspectorPlacement(OBSTRUCTED));
    expect(sceneInspectorPlacement({ ...BESIDE, obstacles: [] }))
      .toEqual(sceneInspectorPlacement(BESIDE));
    expect(sceneInspectorPlacement({ ...STACKED, obstacles: [] }))
      .toEqual(sceneInspectorPlacement(STACKED));
  });

  it('sends the card away from a panel on the right', () => {
    // Unobstructed this is a tie the solver breaks rightward. The rail takes
    // the whole right side away — a 400-wide card pushed past x 1100 ends at
    // 1800, well outside a 1,400px stage — so left is not merely roomier, it
    // is the only side there is.
    expect(sceneInspectorPlacement(OBSTRUCTED).side).toBe('right');
    expect(sceneInspectorPlacement({ ...OBSTRUCTED, obstacles: [RIGHT_RAIL] }))
      .toEqual({ family: 'beside', side: 'left', x: -442, y: -150 });
  });

  it('sends the card away from a panel on the left', () => {
    expect(sceneInspectorPlacement({ ...OBSTRUCTED, obstacles: [LEFT_RAIL] }))
      .toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
  });

  it('clamps the card to a panel edge the anchor is standing behind', () => {
    // The case B-3 measured at 1920: the entity projects UNDER the left rail,
    // so the card placed `gap` to its right still starts inside the rail. The
    // beside room past the rail allows the card, so it lands ON the rail's
    // edge — x 100 rather than 42 — instead of printing over its value column.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      anchorX: 200,
      obstacles: [LEFT_RAIL],
    })).toEqual({ family: 'beside', side: 'right', x: 100, y: -150 });
    // And the room it keeps is the room past the rail: unobstructed the card
    // would sit 58px further left.
    expect(sceneInspectorPlacement({ ...OBSTRUCTED, anchorX: 200 }).x).toBe(42);
  });

  it('reads a panel only on the rows the card occupies', () => {
    // The same column, low instead of full height. The card's band is
    // [250, 550] and the panel starts at 700, so it is not in the way of
    // anything and the card places as if the HUD were not there.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      anchorX: 200,
      obstacles: [LOW_LEFT_PANEL],
    })).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
    // A panel taller than the card's band still blocks it: containment is
    // overlap, and the full-height rail is the case that matters most.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      anchorX: 200,
      obstacles: [LEFT_RAIL],
    }).x).toBe(100);
  });

  /** A card taller than the band — the docked family's own trigger — on the
   *  same 1,400px stage. */
  const DOCKED = { ...OBSTRUCTED, panelHeight: 800 };

  it('settles a docked card off the rail it has the room to clear', () => {
    // A docked card answers a stage too SHORT for the card, which says nothing
    // about how WIDE the stage is. Docking it to the viewport edge regardless
    // put an 856px card over the whole of CELL·03 and PEER·02 at 1920, with
    // 331px of clear stage beside it — measured live. So the edge is where the
    // card starts and the panels push it inward, the same settle the beside
    // family runs.
    expect(sceneInspectorPlacement({ ...DOCKED, obstacles: [] }))
      .toEqual({ family: 'docked', side: 'left', x: -686, y: -296 });
    const settled = sceneInspectorPlacement({
      ...DOCKED,
      obstacles: [LEFT_RAIL],
    });

    expect(settled).toEqual({ family: 'docked', side: 'left', x: -400, y: -296 });
    expect(700 + settled.x).toBe(LEFT_RAIL.right);
  });

  it('keeps the edge when a docked card is wider than the hole', () => {
    // 728 of card against a 710px hole at 1440: settling inward would push the
    // card off the far end of the screen, and a card half off the screen is a
    // worse answer than a covered panel. It keeps the edge and covers a rail.
    const placement = sceneInspectorPlacement({
      ...DOCKED,
      panelWidth: 900,
      obstacles: [LEFT_RAIL, RIGHT_RAIL],
    });

    expect(placement).toEqual({ family: 'docked', side: 'left', x: -686, y: -296 });
    expect(700 + placement.x).toBe(14);
  });

  it('is the same arithmetic the cell card picks its measure by', () => {
    // `CARD_BESIDE_HOLE_PX` reads the hole and asks for `card + 42`. This is
    // where that number comes from: at the friendliest anchor there is — an
    // entity ON the hole's edge, with the whole hole to one side of it — a
    // card of measure `w` is placed beside exactly while `hole >= w + gap`.
    // So a 728 card has a beside placement somewhere in a 770px hole and none
    // anywhere in a 769px one, which is the floor the card's ladder names.
    const rails = (hole: number) => [
      { left: 0, top: 0, right: (1400 - hole) / 2, bottom: 900 },
      { left: (1400 + hole) / 2, top: 0, right: 1400, bottom: 900 },
    ];
    const family = (hole: number, panelWidth: number) => sceneInspectorPlacement({
      ...OBSTRUCTED,
      panelWidth,
      anchorX: (1400 - hole) / 2,
      obstacles: rails(hole),
    }).family;

    expect(family(770, 728)).toBe('beside');
    expect(family(769, 728)).toBe('stacked');
    // …and the wide card's own rung, 856 + 42.
    expect(family(898, 856)).toBe('beside');
    expect(family(897, 856)).toBe('stacked');
  });

  it('falls to the stacked family when both sides are panelled', () => {
    // A card as wide as this one cannot clear either rail from an anchor in
    // the middle of the hole, which is precisely the 1920 geometry: card +
    // gap 898 against a 1,190px hole with the anchor centred in it.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      panelWidth: 700,
      anchorX: 400,
      obstacles: [LEFT_RAIL, RIGHT_RAIL],
    }).side).toBe('below');
  });

  it('slides the stacked card along the hole instead of over a rail', () => {
    // Stacked x is the free axis, so a panel is answered by sliding: the
    // 700-wide card prefers to centre at 50..750, which lies on the left
    // rail, and settles on the rail's edge at 300..1000 — inside the hole,
    // touching neither column.
    const placement = sceneInspectorPlacement({
      ...OBSTRUCTED,
      panelWidth: 700,
      anchorX: 400,
      obstacles: [LEFT_RAIL, RIGHT_RAIL],
    });
    expect(placement).toEqual({ family: 'stacked', side: 'below', x: -100, y: 42 });
    expect(400 + placement.x).toBe(LEFT_RAIL.right);
    expect(400 + placement.x + 700).toBeLessThanOrEqual(RIGHT_RAIL.left);
    // The rails are what drove the card below its anchor at all: on a bare
    // 1,400px stage a 700-wide card still fits beside it.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      panelWidth: 700,
      anchorX: 400,
    }).side).toBe('right');
  });

  it('keeps a held side while a panel leaves the two equally roomy', () => {
    // A 2,142px stage, anchor at 1200, a panel at 900–1000. The left card
    // cannot sit at 758 any more and settles on the panel's edge at 500 — but
    // that is exactly as far from the left edge (486) as the right card is
    // from the right one, so the lead is zero against the 100px margin a
    // 400-wide card buys and a card already living on the left stays there.
    // The obstacle is biting; it just is not an argument for moving.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      viewportWidth: 2142,
      anchorX: 1200,
      heldSide: 'left',
      obstacles: [NEAR_LEFT_PANEL],
    })).toEqual({ family: 'beside', side: 'left', x: -700, y: -150 });
  });

  it('gives way once a panel makes the lead clear the margin', () => {
    // The same anchor and panel on a 2,400px stage: the right side now has
    // 744px of slack to the left side's 486, a 258px lead the margin does not
    // cover, so the held side retires.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      viewportWidth: 2400,
      anchorX: 1200,
      heldSide: 'left',
      obstacles: [NEAR_LEFT_PANEL],
    })).toEqual({ family: 'beside', side: 'right', x: 42, y: -150 });
    // Without the panel the same stage is a dead tie and the card holds: the
    // panel is the whole of the lead.
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      viewportWidth: 2400,
      anchorX: 1200,
      heldSide: 'left',
    }).side).toBe('left');
  });

  it('abandons a held side a panel has taken outright', () => {
    expect(sceneInspectorPlacement({
      ...OBSTRUCTED,
      heldSide: 'right',
      obstacles: [RIGHT_RAIL],
    }).side).toBe('left');
  });

  it('carries the reading through the sticky solve', () => {
    const handles = makeHandles();
    // The 500×300 dialect default against the same right rail: 42 unobstructed,
    // the other side once the rail is in the reading.
    expect(resolveStickyInspectorPlacement(handles, 700, 400, 1400, 900).side)
      .toBe('right');
    resetInspectionPlacementLock(handles);
    expect(resolveStickyInspectorPlacement(
      handles, 700, 400, 1400, 900, [RIGHT_RAIL],
    ).side).toBe('left');
  });
});

/**
 * Every dialect that tethers a card to the scene, by the file it lives in.
 * The chassis takes the reading as an optional prop — a solver told nothing
 * about the HUD has to place as it always did, which is what keeps the
 * equivalence above honest — so nothing but this list makes the five cards
 * actually ask for it. A sixth dialect that forgets is a card back on top of
 * CKB·01 with every test in this file still green.
 */
const INSPECTION_DIALECTS = [
  'CellInspectionOverlay',
  'PeerInspectionOverlay',
  'NodeInspectionOverlay',
  'MinerInspectionOverlay',
  'SightedInspectionOverlay',
] as const;

const COMPONENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/components');

describe('inspection dialects read the HUD', () => {
  it.each(INSPECTION_DIALECTS)('%s hands the anchor the occlusion rects', (dialect) => {
    const source = readFileSync(join(COMPONENTS_DIR, `${dialect}.tsx`), 'utf8');

    expect(source).toContain('useHudOcclusionRects');
    expect(source).toMatch(/<SceneInspectionAnchor[^>]*\n\s*obstacles=\{obstacles\}/);
  });

  it.each(INSPECTION_DIALECTS)('%s marks its layer so the card is not its own obstacle', (dialect) => {
    // The trace ledger inside the cell card carries `data-hud-occlusion`; the
    // marker on the layer is what keeps a card from fleeing its own contents.
    const source = readFileSync(join(COMPONENTS_DIR, `${dialect}.tsx`), 'utf8');

    expect(source).toContain('data-scene-inspection-layer="true"');
  });
});

/** The two laptop stages the round put in scope, with the HUD's real columns
 *  on them, and the narrow card's real measure (728 wide — the reader lies
 *  under the two columns below 1,400 px) capped at the solver's own band. */
const LAPTOP_STAGES = [
  { viewportWidth: 1280, viewportHeight: 800, rails: [
    { left: 0, top: 76, right: 394, bottom: 800 },
    { left: 934, top: 76, right: 1280, bottom: 800 },
  ] },
  { viewportWidth: 1000, viewportHeight: 720, rails: [
    { left: 0, top: 76, right: 394, bottom: 720 },
    { left: 654, top: 76, right: 1000, bottom: 720 },
  ] },
] as const;

describe('sceneInspectorPlacement docked family', () => {
  const TALL = {
    anchorX: 640,
    anchorY: 400,
    panelWidth: 728,
    panelHeight: 900,
    viewportWidth: 1280,
    viewportHeight: 800,
  };

  it('docks a card taller than the band under the strip', () => {
    // The band is 800 − 14 − 104 = 682 and the card is 900, so neither the
    // beside nor the stacked family has anywhere to put it: both used to clamp
    // to `minY` and hang 218px of dossier off the bottom of the screen.
    const placement = sceneInspectorPlacement(TALL);

    expect(placement.family).toBe('docked');
    expect(TALL.anchorY + placement.y).toBe(104);
  });

  it('docks against the edge the entity is not at', () => {
    // Anchor right of centre → the card takes the left edge, and the reverse.
    const left = sceneInspectorPlacement({ ...TALL, anchorX: 900 });
    expect(left.side).toBe('left');
    expect(900 + left.x).toBe(14);

    const right = sceneInspectorPlacement({ ...TALL, anchorX: 300 });
    expect(right.side).toBe('right');
    expect(300 + right.x + 728).toBe(1280 - 14);
  });

  it('holds the docked family at exactly the band', () => {
    // ⚠️ The fixpoint. A docked card caps its own height AT the band, so the
    // next frame measures exactly 682. Under a strict `>` it would leave the
    // family, drop its cap, grow past the band and dock again — forever.
    expect(sceneInspectorPlacement({ ...TALL, panelHeight: 682 }).family)
      .toBe('docked');
    // One pixel of room and it is an ordinary card again.
    expect(sceneInspectorPlacement({ ...TALL, panelHeight: 681 }).family)
      .not.toBe('docked');
  });

  it('keeps a docked side against a lead under the margin', () => {
    // Anchor 20px right of centre: a 40px lead against the 182px margin a
    // 728-wide card buys, so a card already docked right stays docked right.
    expect(sceneInspectorPlacement({ ...TALL, anchorX: 660, heldSide: 'right' }).side)
      .toBe('right');
    // Far enough over and it moves.
    expect(sceneInspectorPlacement({ ...TALL, anchorX: 900, heldSide: 'right' }).side)
      .toBe('left');
  });

  it.each(LAPTOP_STAGES)(
    'keeps the whole card on a $viewportWidth×$viewportHeight stage',
    ({ viewportWidth, viewportHeight, rails }) => {
      // The narrow card (728, because the reader lies under the columns below
      // 1,400) at the height a full dossier actually builds — the measured
      // 726px plate plus the six-row dump under it — on the compact HUD's real
      // columns, anchored across the whole stage. Two things are asserted at
      // every anchor: the solver says DOCKED, which is the only signal the
      // card has to cap itself with, and the card at that cap keeps every edge
      // on screen. B-1 measured this card running from y 104 to y 830 on an
      // 800px screen, with its PROOF line and caption below the fold.
      const panelWidth = 728;
      const naturalHeight = 877;
      const band = viewportHeight - 118;
      expect(naturalHeight).toBeGreaterThan(band);
      for (let anchorX = 20; anchorX < viewportWidth; anchorX += 20) {
        for (let anchorY = 120; anchorY < viewportHeight; anchorY += 40) {
          const solved = sceneInspectorPlacement({
            anchorX,
            anchorY,
            panelWidth,
            panelHeight: naturalHeight,
            viewportWidth,
            viewportHeight,
            obstacles: rails,
          });
          expect(solved.family).toBe('docked');
          // …and the frame after, measuring the capped card.
          const placement = sceneInspectorPlacement({
            anchorX,
            anchorY,
            panelWidth,
            panelHeight: band,
            viewportWidth,
            viewportHeight,
            obstacles: rails,
          });
          expect(placement.family).toBe('docked');
          const left = anchorX + placement.x;
          const top = anchorY + placement.y;
          expect(left).toBeGreaterThanOrEqual(14);
          expect(top).toBeGreaterThanOrEqual(104);
          expect(left + panelWidth).toBeLessThanOrEqual(viewportWidth - 14);
          expect(top + band).toBeLessThanOrEqual(viewportHeight - 14);
        }
      }
    },
  );
});

// ——— One enter, one exit, five dialects ————————————————————————————————
//
// The chassis is where the five cards agree about anything, and until C8 the
// one thing they did not agree about was arriving: the cell dialect faded its
// frame over 120 ms, slid its body over 280 and popped its dot over 360, while
// the four network dialects had the pop alone. None of them had an exit at all.
describe('the chassis enters and leaves once', () => {
  it('fades in on the reveal rung and on nothing else', () => {
    // The REVEAL rung, and E1's argument for it is that a card does not
    // travel: it appears where the solver put it, at the size it will keep,
    // and the only thing that changes is whether you can see it. The `enter`
    // rung is 360 and belongs to things with a distance in them.
    expect(INSPECTION_CARD_STYLE.transition)
      .toBe(`opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.enterEase}`);
    // Opacity is the whole entrance. `transform` belongs to the frame writer,
    // which sets it every frame the entity is on screen, so a chassis that
    // animated position would be two authors on one property.
    expect(String(INSPECTION_CARD_STYLE.transition)).not.toContain('transform');
    expect(INSPECTION_CARD_STYLE.opacity).toBe(0);
    expect(INSPECTION_CARD_STYLE.animation).toBeUndefined();
  });

  it('fades a leaving card out on the flip rung, and flags the frame writer', () => {
    const handles = createSceneInspectionHandles({
      defaultSize: { width: 340, height: 300 },
      accent: '#ffffff',
      placementDataKey: 'testPlacement',
      connectorDataKey: 'testConnector',
    });
    const card = document.createElement('div');
    card.style.opacity = '1';
    const ref = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
    ref.current = card;

    const view = renderHook(
      ({ leaving }: { leaving: boolean }) => useSceneInspectionExit(handles, ref, leaving),
      { initialProps: { leaving: false } },
    );
    expect(handles.leaving).toBe(false);
    expect(card.style.opacity).toBe('1');

    act(() => { view.rerender({ leaving: true }); });
    expect(handles.leaving).toBe(true);
    expect(card.style.opacity).toBe('0');
    expect(card.style.transition)
      .toBe(`opacity ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`);
    // Under half the arrival: leaving needs less of a reader than arriving.
    expect(HUD_MOTION.flip).toBeLessThan(HUD_MOTION.reveal / 2);
  });

  it('leaves instantly under reduced motion', () => {
    const handles = createSceneInspectionHandles({
      defaultSize: { width: 340, height: 300 },
      accent: '#ffffff',
      placementDataKey: 'testPlacement',
      connectorDataKey: 'testConnector',
    });
    const card = document.createElement('div');
    const ref = { current: card as HTMLDivElement | null };

    renderHook(() => useSceneInspectionExit(handles, ref, true, true));

    expect(card.style.transition).toBe('none');
    expect(card.style.opacity).toBe('0');
  });

  it('does not reposition or re-show a card on its way out', () => {
    // The frame writer's own guard, read off the source: a card repositioned
    // mid-exit would slide as it faded, which is a second gesture nobody asked
    // for — and one that re-showed it would cancel the fade outright.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/components/sceneInspection.tsx'),
      'utf8',
    );
    expect(source).toContain('if (handles.leaving) return;');
  });
});

/** An 11" iPad Air in landscape Safari, measured 2026-09-10: the browser's
 *  toolbar takes 75px of window that `env()` never reports, so the Canvas was
 *  laid out `100vh` = 763px tall inside a 688px window. The card is the docked
 *  family's own fixpoint there — capped at the band, 570 = 688 − 104 − 14 —
 *  which is what puts the two heights on opposite sides of `minY >= maxY`. */
describe('the stage the card is placed into', () => {
  const IPAD_CANVAS_H = 763;
  const IPAD_WINDOW_H = 688;
  const IPAD_W = 1180;
  const DOCKED_CARD = { width: 640, height: 570 };

  it('prefers the layer box to the canvas box, and falls back when there is none', () => {
    expect(inspectionStageViewport(IPAD_W, IPAD_CANVAS_H, { width: IPAD_W, height: IPAD_WINDOW_H }))
      .toEqual({ width: IPAD_W, height: IPAD_WINDOW_H });
    // No reading yet (the first frame, or no document at all): the Canvas is
    // the honest answer, and it is the one this solver always had.
    expect(inspectionStageViewport(IPAD_W, IPAD_CANVAS_H, null))
      .toEqual({ width: IPAD_W, height: IPAD_CANVAS_H });
    // A collapsed axis is not a reading — and it is judged per axis, because
    // a collapsed width says nothing about a good height.
    expect(inspectionStageViewport(IPAD_W, IPAD_CANVAS_H, { width: 0, height: IPAD_WINDOW_H }))
      .toEqual({ width: IPAD_W, height: IPAD_WINDOW_H });
    expect(inspectionStageViewport(IPAD_W, IPAD_CANVAS_H, { width: IPAD_W, height: 0 }))
      .toEqual({ width: IPAD_W, height: IPAD_CANVAS_H });
  });

  it('changes COMPOSITION between the two boxes, which is why they may not be mixed', () => {
    // The whole cost of the confusion, in one assertion. 75px of browser
    // chrome is not a nudge to a placement: it is a different family, and a
    // frame loop holding both spellings alternates between them forever.
    // Measured on the device before the fix: 213 moves in 214 frames, the two
    // answers 256px apart, 60fps carrying the relayout down to 27.
    const common = {
      anchorX: 590,
      anchorY: 293,
      panelWidth: DOCKED_CARD.width,
      panelHeight: DOCKED_CARD.height,
      viewportWidth: IPAD_W,
    };
    const inWindow = sceneInspectorPlacement({ ...common, viewportHeight: IPAD_WINDOW_H });
    const inCanvas = sceneInspectorPlacement({ ...common, viewportHeight: IPAD_CANVAS_H });

    expect(inWindow.family).toBe('docked');
    expect(inCanvas.family).not.toBe('docked');
  });


  it('keeps a capped card docked, which is the fixpoint the cap exists for', () => {
    // The iPad's stage: an 688px window less the 25px home indicator, which is
    // what `viewportMinusSafeArea` resolves to and therefore what the card's
    // own `maxHeight` is measured against. The solver must reason about the
    // SAME height, or the cap lands short of the band and the card leaves the
    // family it was just capped for — on the next frame, and every frame after.
    const STAGE_H = 688 - 25;
    const cap = STAGE_H - (INSPECTOR_SAFE_TOP_PX + INSPECTOR_EDGE_PX);
    const capped = sceneInspectorPlacement({
      anchorX: 590,
      anchorY: 293,
      panelWidth: 640,
      panelHeight: cap,
      viewportWidth: 1180 - 0,
      viewportHeight: STAGE_H,
    });

    expect(capped.family).toBe('docked');

    // …and the whole viewport is what it must NOT be handed: 25px of home
    // indicator is the difference between a fixpoint and a strobe. Measured on
    // the device before the ruler: 300 moves in 300 frames.
    const unInset = sceneInspectorPlacement({
      anchorX: 590,
      anchorY: 293,
      panelWidth: 640,
      panelHeight: cap,
      viewportWidth: 1180,
      viewportHeight: 688,
    });

    expect(unInset.family).not.toBe('docked');
  });

  it('hands the solver the stage and never the Canvas box', () => {
    // The wiring, read off the source: `size` is R3F's Canvas box, right for
    // the projection above this call and wrong for every extent below it.
    const source = readFileSync(
      join(COMPONENTS_DIR, 'sceneInspection.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    // The LAST occurrence is the call; the first is the declaration.
    const at = source.lastIndexOf('resolveStickyInspectorPlacement(');
    const args = source.slice(at, at + 220);

    expect(at).toBeGreaterThan(0);
    expect(args).toContain('stage.width');
    expect(args).toContain('stage.height');
    expect(args).not.toContain('size.');
  });
});
