import { describe, expect, it } from 'vitest';
import {
  commitInspectionCardSize,
  commitInspectionFrame,
  createSceneInspectionHandles,
  detachInspectionCard,
  inspectionConnectorRestyleKey,
  inspectionFrameKey,
  resetInspectionPlacementLock,
  resolveStickyInspectorPlacement,
  sceneInspectorPlacement,
  type SceneInspectionHandles,
} from '../../src/components/sceneInspection';

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
      .toEqual({ side: 'right', x: 42, y: -40 });
  });

  it('carries preferredY across a left flip unchanged', () => {
    expect(sceneInspectorPlacement({
      ...BESIDE,
      anchorX: 1000,
      preferredY: -40,
    })).toEqual({ side: 'left', x: -542, y: -40 });
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
      .toEqual({ side: 'below', x: -130, y: 42 });
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
      .toEqual({ side: 'below', x: -150, y: 42 });
  });
});

describe('sticky placement lock', () => {
  it('starts unlocked when the handles are created', () => {
    expect(makeHandles().placementLock)
      .toEqual({ family: null, y: null, x: null });
  });

  it('captures the first beside solve and holds its y while the card grows', () => {
    const handles = makeHandles();

    const opened = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(opened).toEqual({ side: 'right', x: 42, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null });

    // Enrichment arrives, the card grows 120px taller. Committing the new
    // measurement clears the frame signature but must not touch the lock...
    commitInspectionCardSize(handles, 500, 420);
    expect(handles.placementLock.y).toBe(-150);

    // ...so the re-place keeps the top edge where it opened (−150) instead
    // of re-centring to −210: all growth extends downward.
    const grown = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(grown).toEqual({ side: 'right', x: 42, y: -150 });
  });

  it('keeps the y lock across a left/right flip', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);

    const flipped = resolveStickyInspectorPlacement(handles, 1000, 400, 1200, 800);

    expect(flipped).toEqual({ side: 'left', x: -542, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null });
  });

  it('recaptures when the solver changes family', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);

    // The canvas narrows under the 500-wide card: the offsets now measure a
    // different free axis, so the beside lock yields to a fresh stacked one.
    const stacked = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);
    expect(stacked.side).toBe('below');
    expect(handles.placementLock)
      .toEqual({ family: 'stacked', y: null, x: stacked.x });

    // And widening again recaptures a freshly centred beside offset.
    const beside = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(beside).toEqual({ side: 'right', x: 42, y: -150 });
    expect(handles.placementLock)
      .toEqual({ family: 'beside', y: -150, x: null });
  });

  it('holds the stacked x while the card grows on a narrow canvas', () => {
    const handles = createSceneInspectionHandles({
      defaultSize: { width: 300, height: 300 },
      accent: '#ABCDEF',
      placementDataKey: 'probePlacement',
      connectorDataKey: 'probeConnectorDirection',
    });

    const opened = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);
    expect(opened).toEqual({ side: 'below', x: -150, y: 42 });
    expect(handles.placementLock)
      .toEqual({ family: 'stacked', y: null, x: -150 });

    commitInspectionCardSize(handles, 300, 500);
    const grown = resolveStickyInspectorPlacement(handles, 195, 400, 390, 800);

    // The taller card is squeezed up by the bottom edge, but its horizontal
    // offset — the stacked family's sticky axis — stays exactly captured.
    expect(grown).toEqual({ side: 'below', x: -150, y: -114 });
  });

  it('clears on reset so the next selection centres itself afresh', () => {
    const handles = makeHandles();
    resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    commitInspectionCardSize(handles, 500, 420);

    resetInspectionPlacementLock(handles);
    expect(handles.placementLock)
      .toEqual({ family: null, y: null, x: null });

    // With no lock, the taller card centres to −210 and captures that.
    const fresh = resolveStickyInspectorPlacement(handles, 300, 400, 1200, 800);
    expect(fresh).toEqual({ side: 'right', x: 42, y: -210 });
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
      .toEqual({ family: null, y: null, x: null });
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
  const RIGHT = { side: 'right', x: 42, y: -150 } as const;

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
    expect(handles.leader?.style.top).toBe('150px');
    expect(handles.leaderDot?.style.top).toBe('146px');
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

    commitInspectionFrame(handles, { side: 'right', x: 42, y: -158 }, 349, 242);

    expect(leader.style.background).toBe('none');
    expect(leader.style.boxShadow).toBe('none');
    expect(leader.style.width).toBe('0px');
    expect(dot.style.borderColor).toBe('transparent');
    // ...while the two things that actually moved did move.
    expect(handles.card?.style.transform)
      .toBe('translate3d(349px, 242px, 0)');
    expect(leader.style.top).toBe('158px');
    expect(dot.style.top).toBe('154px');
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

    commitInspectionFrame(handles, { side: 'left', x: -542, y: -150 }, 200, 250);

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

    commitInspectionFrame(handles, { side: 'below', x: -150, y: 42 }, 45, 442);
    expect(handles.leader?.style.top).toBe('-42px');
    expect(handles.leader?.style.left).toBe('150px');
    expect(handles.leaderDot?.style.left).toBe('146px');

    (handles.leader as HTMLSpanElement).style.background = 'none';
    commitInspectionFrame(handles, { side: 'below', x: -130, y: 42 }, 65, 442);
    expect(handles.leader?.style.left).toBe('130px');
    expect(handles.leader?.style.background).toBe('none');
  });
});
