import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Cell } from '@cknerv/types';
import CellDetailPanel, {
  cellScanFactAccent,
  type CellInspectionFacet,
  type CellDetailPanelProps,
} from './hud/CellDetailPanel';
import { CELL_CARD_ACCENT } from './hud/hudTheme';
import { useReducedMotion } from './hud/useReducedMotion';
import {
  clearCellPortraitCardOrigin,
  setCellPortraitCardOrigin,
} from './hud/cellPortraitInsetChannel';
import {
  commitInspectionCardSize,
  createSceneInspectionHandles,
  detachInspectionCard,
  INSPECTION_CARD_STYLE,
  INSPECTION_LAYER_STYLE,
  resetInspectionPlacementLock,
  SceneInspectionAnchor,
  SceneInspectionConnector,
  useSceneInspectionDismiss,
  useSceneInspectionLayoutSide,
  type SceneInspectionHandles,
  type SceneInspectorPlacement,
} from './sceneInspection';
import { useHudOcclusionRects } from './hudOcclusion';

const DEFAULT_PANEL_WIDTH_PX = 728;
// Estimated dossier card at open (the analysis column, masthead included,
// before enrichment evidence fills in); the ResizeObserver corrects it on the
// first measured frame.
const DEFAULT_PANEL_HEIGHT_PX = 620;

export type CellInspectorPlacement = SceneInspectorPlacement;
export type CellInspectionHandles = SceneInspectionHandles;

export {
  sceneInspectorPlacement as cellInspectorPlacement,
  useSceneInspectionDismiss as useCellInspectionDismiss,
} from './sceneInspection';

/** The Cell card is the widest inspection dialect: a full specimen scan, not
 * a probe readout, so it places by a specimen-sized box until measured. */
export function createCellInspectionHandles(): CellInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: {
      width: DEFAULT_PANEL_WIDTH_PX,
      height: DEFAULT_PANEL_HEIGHT_PX,
    },
    accent: CELL_CARD_ACCENT,
    placementDataKey: 'cellInspectorPlacement',
    connectorDataKey: 'cellInspectorConnectorDirection',
  });
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

/** The colour the card frame and its connector take while one fact is open.
 *
 *  The rule is the one `CELL_CARD_ACCENT` is documented with, and both halves
 *  of it had rotted. Nothing selected → the frame says what the thing IS, in
 *  the organism's own rose; this used to answer with the asset family instead,
 *  and since `asset_kind` is non-optional on the wire the rose branch never ran
 *  — so a plain CKB Cell, the commonest thing on the stage, tethered in the
 *  peer plane's cyan on the one line whose whole job is to say "this card is
 *  about that Cell". A fact IS selected → that fact's colour wins, and it is
 *  the SAME colour the fact's own button wears, because this asks
 *  `cellScanFactAccent` rather than keeping a second copy of that table. The
 *  copy is how COMMIT ended up orange out here and cyan in the register.
 *
 *  `born → orange` is the declared exception and it stays: an anchor is a house
 *  fact, and chrome on chrome is the instrument's own colour rather than a
 *  borrow from anywhere. The button moved to it, not the tether away from it.
 *
 *  It reads the record the register reads, so a script the index NAMED but the
 *  local table cannot place says `ink` in both places instead of `ink` in one
 *  and a near-black swatch in the other. */
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

/** The braid inset draws inside the card, so the portrait channel needs the
 * same origin the frame writer is about to commit. */
function publishCellPortraitOrigin(
  anchorX: number,
  anchorY: number,
  placement: CellInspectorPlacement,
): void {
  const cardX = anchorX + placement.x;
  const cardY = anchorY + placement.y;
  setCellPortraitCardOrigin(cardX, cardY);
}

/**
 * Scene half of the inspector: the shared anchor at the Cell's seed position,
 * rendered inside the Galaxy overlay so it inherits the Galaxy's transform.
 * The Cell dialect hangs one channel off the generic frame — the braid inset
 * draws from the card origin, and never into a card that is off screen.
 */
export function CellInspectionAnchor({
  cell,
  handles,
}: {
  cell: Cell;
  handles: CellInspectionHandles;
}) {
  // The braid inset must not draw into a hidden or unmounted card.
  useEffect(() => () => clearCellPortraitCardOrigin(), []);
  const obstacles = useHudOcclusionRects();

  return (
    <SceneInspectionAnchor
      position={cell.pos_seed}
      handles={handles}
      obstacles={obstacles}
      onCardFrame={publishCellPortraitOrigin}
      onCardHidden={clearCellPortraitCardOrigin}
    />
  );
}

export type CellInspectionOverlayProps = CellDetailPanelProps & {
  handles: CellInspectionHandles;
};

/**
 * Cell-centred detail constellation — the DOM half. The selected scene Cell
 * remains visually intact; one screen-space connector makes it the explicit
 * source of the decoded windows and flips around viewport edges.
 *
 * It also keeps clear of the HUD's panels, which for a long time this comment
 * claimed and the solver had no way to do: the placement rule knew the
 * viewport edges and the safe top and nothing else, so at 1920 the card landed
 * 209 px into CKB·01 and hid its whole value column. The rails are obstacles
 * to the solver now (`useHudOcclusionRects` → `sceneInspectorPlacement`), and
 * the claim is only as true as the room allows: a card wider than the gap
 * between two panels still has to land somewhere, and where it lands on one it
 * dims it rather than printing through it.
 *
 * Rendered as a sibling of the Canvas: pointer events inside the card can
 * never reach the R3F root, so no stopPropagation shims are needed and
 * onPointerMissed only ever sees genuine scene clicks.
 */
function CellInspectionOverlay(props: CellInspectionOverlayProps) {
  const {
    handles,
    ...panelProps
  } = props;
  const {
    cell,
    onClose,
    onInspectionFieldChange,
    onScanInteractionChange,
  } = panelProps;
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [focusField, setFocusField] = useState<CellInspectionFacet | null>(null);
  // Render-time write into the mutable channel: the anchor folds the accent
  // into its frame signature, so a focus change re-tints the connector on the
  // next frame without any React coupling between the two trees.
  handles.accent = selectedCellScanAccent(panelProps, focusField);
  const layoutSide = useSceneInspectionLayoutSide(handles);
  const handleInspectionFieldChange = useCallback((field: CellInspectionFacet | null) => {
    setFocusField(field);
    onInspectionFieldChange?.(field);
  }, [onInspectionFieldChange]);
  useSceneInspectionDismiss(cardRef, onClose);

  // The sticky offset belongs to one selection: a different Cell may open
  // anywhere on screen, so the lock clears whenever the inspected id changes
  // — and the card it grows for centres itself once, then holds its ground.
  useEffect(() => {
    resetInspectionPlacementLock(handles);
  }, [cell.id, handles]);

  // The portrait owns a second pointer boundary. Reset the parent interaction
  // lock at the overlay boundary as well as inside the portrait, so a close
  // during pointer capture cannot leave Galaxy controls disabled.
  useEffect(() => () => {
    onInspectionFieldChange?.(null);
    onScanInteractionChange?.(false);
  }, [onInspectionFieldChange, onScanInteractionChange]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    handles.card = card;
    if (!card) return;
    const initialRect = card.getBoundingClientRect();
    commitInspectionCardSize(handles, initialRect.width, initialRect.height);
    const detach = () => detachInspectionCard(handles, card);
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(([entry]) => {
      const borderBox = entry.borderBoxSize?.[0];
      commitInspectionCardSize(
        handles,
        borderBox?.inlineSize ?? entry.contentRect.width,
        borderBox?.blockSize ?? entry.contentRect.height,
      );
    });
    observer.observe(card);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [cell.id, handles]);

  // Chassis seam: everything below is the Cell dialect's DOM identity — the
  // attributes CSS, the portrait inset and the tests read the card by. The
  // placement, projection, connector writing and measurement rules all live
  // in sceneInspection, so a second inspected entity re-dresses this frame
  // rather than rebuilding it.
  return (
    <div
      data-cell-inspection-layer
      data-scene-inspection-layer="true"
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={cardRef}
        data-cell-inspection-overlay
        data-cell-inspection-dismiss-boundary="true"
        data-cell-id={cell.id}
        role="region"
        aria-label={`Cell ${cell.id} details`}
        style={INSPECTION_CARD_STYLE}
      >
        <SceneInspectionConnector
          handles={handles}
          leaderAttributes={{
            'data-cell-inspector-leader': true,
            'data-cell-detail-connector': true,
          }}
          dotAttributes={{ 'data-cell-detail-anchor': true }}
          dotEnterAnimation={reduced
            ? undefined
            : 'cknerv-cell-detail-anchor-enter 360ms cubic-bezier(.2,.82,.2,1) both'}
        />
        <CellDetailPanel
          {...panelProps}
          layoutSide={layoutSide}
          onInspectionFieldChange={handleInspectionFieldChange}
        />
      </div>
    </div>
  );
}

// Memoized: App renders several times a second for things no card reads — a
// mempool tick, a peer poll, a hover the scene answered — and this is the
// 2,200-line dossier on the far side of every one of them. With App holding
// the callbacks and the navigation readout by identity, the shallow compare
// lets a card open for a minute skip the renders that carry nothing for it,
// and still re-render on every cells or links batch, which do.
export default memo(CellInspectionOverlay);
