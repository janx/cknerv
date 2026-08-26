import {
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type { RosterNode } from '@cknerv/types';
import SightedNodeCard, {
  SIGHTED_NODE_ACCENT,
  sightedNodeSpokenWord,
} from './hud/SightedNodeCard';
import type { PeerSightingState } from './hud/PeerSightingPlate';
import type { PeerMiningCandidacy } from '../derives/blockProducers.derive';
import { useReducedMotion } from './hud/useReducedMotion';
import type { Vec3 } from '../types';
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
} from './sceneInspection';

/** The shortest of the three dialects — a header, three roster facts, the
 *  dossier and one honesty line — so it places by its own small box until the
 *  card has been measured. */
const DEFAULT_CARD_WIDTH_PX = 340;
const DEFAULT_CARD_HEIGHT_PX = 380;

/** Entering the connector dot is chassis behaviour rather than a cell one —
 *  the keyframe lives in the shared HUD theme, injected once app-wide. */
const CONNECTOR_DOT_ENTER =
  'cknerv-cell-detail-anchor-enter 360ms cubic-bezier(.2,.82,.2,1) both';

export type SightedInspectionHandles = SceneInspectionHandles;

export function createSightedInspectionHandles(): SightedInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: {
      width: DEFAULT_CARD_WIDTH_PX,
      height: DEFAULT_CARD_HEIGHT_PX,
    },
    // No facets and no lost state on this dialect either — the roster tier's
    // own scaffold cyan holds for as long as the card is open.
    accent: SIGHTED_NODE_ACCENT,
    placementDataKey: 'sightedProbePlacement',
    connectorDataKey: 'sightedProbeConnectorDirection',
  });
}

/**
 * Scene half of the sighted probe: the shared anchor at the node's staged
 * point in the colony, mounted through NetworkColony's overlay slot so it
 * reads colony space — the same slot the link probe uses, and only ever one of
 * them at a time, because the selection is single. Like both siblings it hangs
 * nothing off the frame: the projected point only moves the card and its
 * connector.
 */
export function SightedInspectionAnchor({
  position,
  handles,
}: {
  position: Vec3;
  handles: SightedInspectionHandles;
}) {
  return <SceneInspectionAnchor position={position} handles={handles} />;
}

export interface SightedInspectionOverlayProps {
  handles: SightedInspectionHandles;
  /** The crawler's roster row for the staged node the user clicked. */
  node: RosterNode;
  /** The crawler's fuller dossier on the same node, on the same lazy lookup
   *  the other two dialects use. Absent whenever the source advertises no
   *  `peer_sighting` capability; the card is complete without it. */
  sighting?: PeerSightingState;
  /** Whether this node runs a build one of the chain's recent producers
   *  declared — a chain fact joined against the crawler's roster, resolved by
   *  the host off the LIVE producer view. */
  candidacy?: PeerMiningCandidacy | null;
  onClose: () => void;
}

/**
 * Sighted-node probe — the DOM half. A Canvas sibling, so pointer events
 * inside the card never reach the R3F root and the colony's own selection
 * raycasts stay untouched.
 *
 * No retention epilogue, unlike the link probe: nothing here is linked, so
 * nothing can be lost. When a crawl round stops staging this node the card
 * simply goes with the selection — and if the node dropped out because it came
 * online as one of our peers, App re-selects it into the live dialect instead,
 * which is a promotion rather than an ending.
 */
export default function SightedInspectionOverlay({
  handles,
  node,
  sighting,
  candidacy,
  onClose,
}: SightedInspectionOverlayProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  // Render-time write into the mutable channel, as the sibling dialects do.
  // The sighted card has no facets and no lost state, so the tether holds the
  // tier's own cyan for exactly as long as the card is open.
  handles.accent = SIGHTED_NODE_ACCENT;
  const layoutSide = useSceneInspectionLayoutSide(handles);
  useSceneInspectionDismiss(cardRef, onClose);

  // The sticky offset belongs to one selection: sighting a different roster
  // node clears the lock, so its card centres itself afresh beside it.
  useEffect(() => {
    resetInspectionPlacementLock(handles);
  }, [node.node_id, handles]);

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
  }, [node.node_id, handles]);

  return (
    <div
      data-sighted-probe-layer
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={cardRef}
        data-sighted-probe-overlay
        data-sighted-probe-dismiss-boundary="true"
        data-sighted-probe-node={node.node_id}
        role="region"
        aria-label={`${sightedNodeSpokenWord(node.state)} node ${node.node_id} inspection`}
        style={INSPECTION_CARD_STYLE}
      >
        <SceneInspectionConnector
          handles={handles}
          leaderAttributes={{ 'data-sighted-probe-leader': true }}
          dotAttributes={{ 'data-sighted-probe-anchor': true }}
          dotEnterAnimation={reduced ? undefined : CONNECTOR_DOT_ENTER}
        />
        <SightedNodeCard
          node={node}
          layoutSide={layoutSide}
          sighting={sighting}
          candidacy={candidacy}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
