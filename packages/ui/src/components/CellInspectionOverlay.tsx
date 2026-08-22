import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Cell } from '@cknerv/types';
import CellDetailPanel, {
  type CellInspectionFacet,
  type CellDetailPanelProps,
} from './hud/CellDetailPanel';
import { ASSET_COLORS, LOCK_COLORS } from './hud/cellFormat';
import { HUD_COLORS } from './hud/hudTheme';
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
  type SceneInspectorPlacementSide,
} from './sceneInspection';

const DEFAULT_PANEL_WIDTH_PX = 808;
// Estimated CKBYTES ANALYSIS card at open (header + notched analysis plate
// before enrichment evidence fills in); the ResizeObserver corrects it on the
// first measured frame.
const DEFAULT_PANEL_HEIGHT_PX = 668;

export type CellInspectorPlacementSide = SceneInspectorPlacementSide;
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
    placementDataKey: 'cellInspectorPlacement',
    connectorDataKey: 'cellInspectorConnectorDirection',
  });
}

export function selectedCellScanAccent(
  props: Pick<CellDetailPanelProps, 'cell'>,
  field: CellInspectionFacet | null,
): string {
  const { cell } = props;
  if (field === 'lock' && cell.lock_kind) return LOCK_COLORS[cell.lock_kind];
  if (field === 'asset' && cell.asset_kind) return ASSET_COLORS[cell.asset_kind];
  if (field === 'data') return HUD_COLORS.nominal;
  if (field === 'state') {
    return cell.death_at_ms === null ? HUD_COLORS.nominal : HUD_COLORS.caution;
  }
  if (field === 'born') return HUD_COLORS.orange;
  return cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.cyanWire;
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

  return (
    <SceneInspectionAnchor
      position={cell.pos_seed}
      handles={handles}
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
 * source of the decoded windows, flips around viewport edges, and avoids both
 * fixed rails. Rendered as a sibling of the Canvas: pointer events inside the
 * card can never reach the R3F root, so no stopPropagation shims are needed
 * and onPointerMissed only ever sees genuine scene clicks.
 */
export default function CellInspectionOverlay(props: CellInspectionOverlayProps) {
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
  handles.accent = selectedCellScanAccent({ cell }, focusField);
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
