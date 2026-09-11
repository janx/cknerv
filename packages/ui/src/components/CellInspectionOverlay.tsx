import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import CellDetailPanel, {
  cellScanFactAccent,
  type CellInspectionFacet,
  type CellDetailPanelProps,
} from './hud/CellDetailPanel';
import { CELL_CARD_ACCENT, HUD_COLORS, HUD_FONTS, HUD_MOTION, rgba } from './hud/hudTheme';
import { useReducedMotion } from './hud/useReducedMotion';
import { formatAge, formatOutpoint } from './hud/cellFormat';
import {
  clearCellPortraitCardOrigin,
  setCellPortraitCardOrigin,
} from './hud/cellPortraitInsetChannel';
import {
  CellConstellationLeaders,
  CellNameChip,
  CellReticle,
} from './hud/CellConstellationMarks';
import {
  advanceConstellationFrame,
  createCellConstellationHandles,
  invalidateConstellationFrame,
  setConstellationVisible,
  suspendConstellationFrame,
  type CellConstellationHandles,
} from './hud/cellConstellationFrame';
import {
  createCellConstellationCameraMotion,
  settleCellConstellationCameraMotion,
  type CellConstellationCameraMotion,
} from './hud/cellConstellationCameraMotion';
import {
  resetConstellationLock,
  type ConstellationSlot,
} from '../derives/cellConstellation.derive';
import {
  INSPECTION_LAYER_STYLE,
  INSPECTOR_EDGE_PX,
  INSPECTOR_SAFE_TOP_PX,
  inspectionStageViewport,
  useInspectionStageBox,
  useSceneInspectionDismiss,
} from './sceneInspection';
import {
  dimHudPanelsUnder,
  hudOcclusionVersion,
  HUD_DIM_SAMPLE_MS,
  useHudOcclusionRects,
  type HudOcclusionRect,
} from './hudOcclusion';

/** The dialect's channel. Named for the seam App holds it by, and nothing out
 *  there needs to know that the one card behind it became four instruments. */
export type CellInspectionHandles = CellConstellationHandles & {
  /** Kept on App's reused channel so a Cell switch during damping does not
   * reset camera history and flash the new selection's leaders for one frame. */
  cameraMotion: CellConstellationCameraMotion;
};

export { useSceneInspectionDismiss as useCellInspectionDismiss } from './sceneInspection';

/**
 * The Cell dialect's channel between its anchor and its instruments.
 *
 * There is no `defaultSize` any more and that is the point: a card had to be
 * placed by a guess until it was measured, because the guess and the truth were
 * one box. Each instrument here is placed only once its own content has been
 * measured, and a Cell that holds no bytes simply never registers a reader.
 */
export function createCellInspectionHandles(): CellInspectionHandles {
  return {
    ...createCellConstellationHandles(),
    cameraMotion: createCellConstellationCameraMotion(),
  };
}

/** The stage is black and the tether is two pixels of line drawn on it, which
 *  is a floor the register's text does not have: an unplaced script's band is
 *  a near-black swatch — readable as a filled chip on a plate, invisible as a
 *  hairline over the galaxy. 3:1 against the stage is the line; every colour a
 *  facet can answer with clears 4.4:1 except that one, which sits at 2.0. */
const TETHER_STAGE_CONTRAST_FLOOR = 3;

/** WCAG relative luminance, which is the only reading that says whether a thin
 *  line survives on black — `CONTENT_BANDS.unlisted` is a fifth of the way up
 *  in raw channel values and a twentieth of the way up in light. */
function stageContrast(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (offset: number): number => {
    const value = parseInt(h.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return (luminance + 0.05) / 0.05;
}

/**
 * The colour the identity chain takes while one fact is open — the reticle on
 * the cell, the leaders running from it, and the register's own frame.
 *
 * The rule is the one `CELL_CARD_ACCENT` is documented with. Nothing selected →
 * the mark says what the thing IS, in the organism's own rose. A fact IS
 * selected → that fact's colour wins, and it is the SAME colour the fact's own
 * button wears, because this asks `cellScanFactAccent` rather than keeping a
 * second copy of that table.
 *
 * `born → orange` is the declared exception and it stays: an anchor is a house
 * fact, and chrome on chrome is the instrument's own colour rather than a
 * borrow from anywhere.
 */
export function selectedCellScanAccent(
  props: Pick<CellDetailPanelProps, 'cell' | 'semanticRecord'>,
  field: CellInspectionFacet | null,
): string {
  if (field === null) return CELL_CARD_ACCENT;
  const accent = cellScanFactAccent(props.cell, field, props.semanticRecord);
  return stageContrast(accent) >= TETHER_STAGE_CONTRAST_FLOOR
    ? accent
    : CELL_CARD_ACCENT;
}

/**
 * Scene half of the inspector: one anchor at the Cell's seed position, inside
 * the Galaxy overlay so it inherits the Galaxy's transform.
 *
 * One projection drives four boxes. The alternative — an anchor per instrument
 * — would project the same point four times a frame and could disagree with
 * itself about where the cell is; and the placement is a WALK, in which each
 * instrument is seated against the ones already standing, so it cannot be split
 * across four independent solvers anyway.
 */
export function CellInspectionAnchor({
  cell,
  handles,
}: {
  cell: Cell;
  handles: CellInspectionHandles;
}) {
  const anchorRef = useRef<THREE.Group>(null);
  const anchorWorld = useRef(new THREE.Vector3());
  const projected = useRef(new THREE.Vector3());
  const stageBox = useInspectionStageBox();
  const obstacles = useHudOcclusionRects();

  // The braid inset must not draw into a hidden or unmounted panel.
  useEffect(() => () => clearCellPortraitCardOrigin(), []);
  useEffect(() => {
    resetConstellationLock(handles.lock);
    invalidateConstellationFrame(handles);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') invalidateConstellationFrame(handles);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      invalidateConstellationFrame(handles);
    };
  }, [cell.id, handles]);

  useFrame(({ camera, size, clock }) => {
    const anchor = anchorRef.current;
    if (!anchor || !handles.root) return;
    anchor.updateWorldMatrix(true, false);
    anchorWorld.current.setFromMatrixPosition(anchor.matrixWorld);
    projected.current.copy(anchorWorld.current).project(camera);
    // A constellation on its way out is not repositioned and not re-shown: its
    // opacity belongs to the exit for as long as the exit lasts.
    if (handles.leaving) return;
    const visible = projected.current.z >= -1
      && projected.current.z <= 1
      && Math.abs(projected.current.x) <= 1.08
      && Math.abs(projected.current.y) <= 1.08;
    setConstellationVisible(handles, visible);
    if (!visible) {
      invalidateConstellationFrame(handles);
      clearCellPortraitCardOrigin();
      return;
    }
    // The anchor is projected in the Canvas's box, which is where the
    // projection happens and where the two boxes share an origin. The STAGE the
    // walk reasons about is the layer's, which is not always the same box — see
    // `inspectionStageViewport`.
    const anchorX = (projected.current.x * 0.5 + 0.5) * size.width;
    const anchorY = (-projected.current.y * 0.5 + 0.5) * size.height;
    const stage = inspectionStageViewport(size.width, size.height, stageBox.current);
    const cameraMoving = settleCellConstellationCameraMotion(
      handles.cameraMotion,
      camera,
      anchorWorld.current,
      size.height,
      clock.elapsedTime * 1_000,
    );
    if (cameraMoving) {
      const specimen = suspendConstellationFrame(
        handles,
        anchorX,
        anchorY,
        stage.width,
        stage.height,
        INSPECTOR_EDGE_PX,
      );
      if (specimen) setCellPortraitCardOrigin(specimen.x, specimen.y);
      else clearCellPortraitCardOrigin();
      return;
    }
    const specimen = advanceConstellationFrame(
      handles,
      anchorX,
      anchorY,
      stage.width,
      stage.height,
      INSPECTOR_SAFE_TOP_PX,
      INSPECTOR_EDGE_PX,
      obstacles,
      hudOcclusionVersion(),
      clock.elapsedTime,
    );
    // The braid is scissored into the specimen's window, and the window's own
    // offset is measured inside that panel — so the origin the scene needs is
    // the panel's, every frame it moves.
    if (specimen) setCellPortraitCardOrigin(specimen.x, specimen.y);
    else clearCellPortraitCardOrigin();
  });

  return <group ref={anchorRef} position={cell.pos_seed} />;
}

export type CellInspectionOverlayProps = CellDetailPanelProps & {
  handles: CellInspectionHandles;
  /** The selection has been cleared and the chassis owes the instruments their
   *  exit; the dialect holds the subject for `HUD_MOTION.flip` so there is
   *  something to fade. */
  leaving?: boolean;
};

/**
 * Cell-centred detail constellation — the DOM half.
 *
 * CELL SCAN, SCAN·01 and SCAN·02 stand APART, at three corners around the
 * selected Cell (the user's direction of 2026-09-10). The Cell wears a reticle
 * and its own name, and a labelled leader runs from it to each instrument, so
 * what used to be implied by adjacency inside one grid is now drawn.
 *
 * The layout consequences are the whole reason for it. Nothing shares a height
 * with anything, so the remainders that made every void measured on the welded
 * card — 21 % of the bare card's box as enclosed galaxy, 58 % of the reader
 * plate as bordered emptiness, a 35.5 px collision between the specimen square
 * and the reader on an 11" iPad — have no mechanism left. And the cell is never
 * covered by the instruments describing it, which is a promise a card placed
 * beside a cell it is wider than could not make.
 *
 * Rendered as a sibling of the Canvas: pointer events inside an instrument can
 * never reach the R3F root, so no stopPropagation shims are needed and
 * onPointerMissed only ever sees genuine scene clicks.
 */
function CellInspectionOverlay(props: CellInspectionOverlayProps) {
  const { handles, leaving = false, ...panelProps } = props;
  const {
    cell,
    onClose,
    onInspectionFieldChange,
    onScanInteractionChange,
  } = panelProps;
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusField, setFocusField] = useState<CellInspectionFacet | null>(null);
  const [openSlots, setOpenSlots] = useState<readonly ConstellationSlot[]>([]);
  const accent = selectedCellScanAccent(panelProps, focusField);

  const handleInspectionFieldChange = useCallback((field: CellInspectionFacet | null) => {
    setFocusField(field);
    onInspectionFieldChange?.(field);
  }, [onInspectionFieldChange]);
  useSceneInspectionDismiss(rootRef, onClose);

  // The exit. Written imperatively for the reason the dim is: the frame writer
  // owns `opacity` on this element, so React's idea of the style is already
  // stale and re-rendering it would not move anything.
  useEffect(() => {
    handles.leaving = leaving;
    const root = rootRef.current;
    if (!root || !leaving) return;
    root.style.transition = reduced
      ? 'none'
      : `opacity ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`;
    root.style.opacity = '0';
  }, [handles, leaving, reduced]);

  useEffect(() => {
    handles.root = rootRef.current;
    // ⚠️ AND THE VISIBILITY IS FORGOTTEN WITH IT.
    //
    // App creates the channel ONCE and re-uses it for every Cell, so
    // `handles.visible` outlives the element it was true of. React mounts each
    // selection's root at `opacity: 0` — the chassis's one entrance — and the
    // frame writer only writes opacity when the answer CHANGES, so the second
    // Cell a reader opens got a constellation that was placed correctly, sized
    // correctly, tracking its cell correctly, and completely invisible. Caught
    // live on the seventh selection, with the braid still drawing into a
    // scissored box the DOM around it never showed.
    handles.visible = false;
    invalidateConstellationFrame(handles);
    return () => { handles.root = null; };
  }, [handles, cell.id]);

  // A different Cell opens somewhere else on screen and owes nobody the rooms
  // the last one chose.
  useEffect(() => {
    resetConstellationLock(handles.lock);
    invalidateConstellationFrame(handles);
    setFocusField(null);
  }, [cell.id, handles]);

  // LAW 1's fallback, and only a fallback. The walk keeps every instrument off
  // the HUD's rails wherever the stage has the room, and scores a rail it must
  // stand on. Where it does stand on one, the rail gives way rather than being
  // read through: the specimen's window is a hole in its panel — the braid is
  // painted in the SCENE, beneath the whole DOM HUD — so any panel between the
  // canvas and it prints across the specimen.
  //
  // Each instrument claims its own box. A union rectangle would dim rails that
  // nothing covers, which is a panel standing aside for no one.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const claims: HudOcclusionRect[] = [];
    const sample = () => {
      claims.length = 0;
      const panels = root.querySelectorAll<HTMLElement>('[data-cell-constellation-panel]');
      for (let index = 0; index < panels.length; index += 1) {
        const box = panels[index].getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        claims.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
      }
      dimHudPanelsUnder(claims.length > 0 ? claims : null);
    };
    sample();
    const id = setInterval(sample, HUD_DIM_SAMPLE_MS);
    return () => {
      clearInterval(id);
      dimHudPanelsUnder(null);
    };
  }, [cell.id]);

  // The portrait owns a second pointer boundary. Reset the parent interaction
  // lock at the overlay boundary as well as inside the portrait, so a close
  // during pointer capture cannot leave Galaxy controls disabled.
  useEffect(() => () => {
    onInspectionFieldChange?.(null);
    onScanInteractionChange?.(false);
  }, [onInspectionFieldChange, onScanInteractionChange]);

  // How long it has stood, which nothing in the register says — the reading the
  // register's masthead used to carry, on the chip that carries the identity
  // now. Composition backfill emits `born_at_ms` 0 for Cells born before the
  // retained window; an epoch-relative age would read as decades, so those
  // carry the lamp alone.
  const lifetime = useMemo(
    () => (cell.born_at_ms > 0 ? `AGE ${formatAge(cell.born_at_ms, Date.now())}` : ''),
    [cell.born_at_ms],
  );
  const live = !(cell.death_at_ms && cell.death_at_ms > 0);

  return (
    <div
      data-cell-inspection-layer
      data-scene-inspection-layer="true"
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={rootRef}
        data-cell-inspection-overlay
        data-cell-inspection-dismiss-boundary="true"
        data-cell-id={cell.id}
        data-cell-inspection-accent={accent}
        role="region"
        aria-label={`Cell ${cell.id} details`}
        style={{
          position: 'absolute',
          inset: 0,
          // The instruments arrive once, together, where the walk put them —
          // the chassis's one entrance, kept. Nothing travels.
          opacity: 0,
          transition: `opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.enterEase}`,
          pointerEvents: 'none',
          color: HUD_COLORS.ink,
          fontFamily: HUD_FONTS.mono,
          // The identity chain's colour, in one place: the reticle, the leaders
          // and the register's frame read it, so a focused fact re-tints all
          // three from a single write.
          ['--cell-accent' as string]: accent,
          ['--cell-accent-line' as string]: rgba(accent, 0.72),
          ['--cell-accent-chip' as string]: rgba(accent, 0.4),
        }}
      >
        <CellConstellationLeaders handles={handles} slots={openSlots} />
        <CellDetailPanel
          {...panelProps}
          handles={handles}
          accent={accent}
          onSlotsChange={setOpenSlots}
          onInspectionFieldChange={handleInspectionFieldChange}
        />
        <CellReticle handles={handles} />
        <CellNameChip
          handles={handles}
          id={cell.id}
          outpoint={formatOutpoint(cell.out_point.tx_hash, cell.out_point.index)}
          live={live}
          lifetime={lifetime}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

// Memoized: App renders several times a second for things no instrument reads —
// a mempool tick, a peer poll, a hover the scene answered — and this is the
// dossier on the far side of every one of them.
export default memo(CellInspectionOverlay);
