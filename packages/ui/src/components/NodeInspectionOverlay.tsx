import {
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import NodeSelfCard, { NODE_SELF_ACCENT } from './hud/NodeSelfCard';
import type { PeerSightingState } from './hud/PeerSightingPlate';
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

/** The self probe is a shorter stack than the link probe — three plates and
 *  no compass — so it places by its own box until the card is measured. */
const DEFAULT_CARD_WIDTH_PX = 340;
const DEFAULT_CARD_HEIGHT_PX = 420;

/** Entering the connector dot is chassis behaviour rather than a cell one —
 *  the keyframe lives in the shared HUD theme, injected once app-wide. */
const CONNECTOR_DOT_ENTER =
  'cknerv-cell-detail-anchor-enter 360ms cubic-bezier(.2,.82,.2,1) both';

export type NodeInspectionHandles = SceneInspectionHandles;

export function createNodeInspectionHandles(): NodeInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: {
      width: DEFAULT_CARD_WIDTH_PX,
      height: DEFAULT_CARD_HEIGHT_PX,
    },
    // The self probe never re-tints, so this is the tether's colour for the
    // whole life of the card: the chain anchor's own edge cyan.
    accent: NODE_SELF_ACCENT,
    placementDataKey: 'nodeProbePlacement',
    connectorDataKey: 'nodeProbeConnectorDirection',
  });
}

/**
 * Scene half of the self probe: the shared anchor at the labeled CkbNodeAnchor
 * the user clicked, mounted through CellGalaxy's overlay slot so it inherits
 * the galaxy transform the icosahedron itself is placed by. Like the peer
 * dialect it hangs nothing off the frame — the projected point only ever moves
 * the card and its connector.
 */
export function NodeInspectionAnchor({
  position,
  handles,
}: {
  position: Vec3;
  handles: NodeInspectionHandles;
}) {
  return <SceneInspectionAnchor position={position} handles={handles} />;
}

export interface NodeInspectionOverlayProps {
  handles: NodeInspectionHandles;
  node: ChainNode;
  /** Chain truth the vitals are read from — tip, epoch, chain name. */
  chain: ChainEntry;
  /** The colony this node stands in, for the STANCE plate. */
  peers: Peer[];
  /** How the network's own crawler last saw this node, when the source can
   *  offer it — the one account of the local node from outside. */
  sighting?: PeerSightingState;
  onClose: () => void;
}

/**
 * Node-tethered self probe — the DOM half. A Canvas sibling, so pointer events
 * inside the card never reach the R3F root and the galaxy's own selection
 * raycasts stay untouched. The local node cannot churn out of existence the
 * way a peer link can, so this dialect keeps no retention epilogue: the card
 * lives exactly as long as the selection does.
 */
export default function NodeInspectionOverlay({
  handles,
  node,
  chain,
  peers,
  sighting,
  onClose,
}: NodeInspectionOverlayProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  // Render-time write into the mutable channel, as the peer dialect does —
  // except the self probe has no facets to re-tint from, so the tether stays
  // the chain anchor's own cyan for as long as the card is open.
  handles.accent = NODE_SELF_ACCENT;
  const layoutSide = useSceneInspectionLayoutSide(handles);
  useSceneInspectionDismiss(cardRef, onClose);

  // There is only ever one self node, but each opening of its card is its
  // own selection: clear the sticky offset so it centres itself afresh.
  useEffect(() => {
    resetInspectionPlacementLock(handles);
  }, [node.id, handles]);

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
  }, [node.id, handles]);

  return (
    <div
      data-node-probe-layer
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={cardRef}
        data-node-probe-overlay
        data-node-probe-dismiss-boundary="true"
        data-node-probe-node={node.id}
        role="region"
        aria-label={`Node ${node.id} inspection`}
        style={INSPECTION_CARD_STYLE}
      >
        <SceneInspectionConnector
          handles={handles}
          leaderAttributes={{ 'data-node-probe-leader': true }}
          dotAttributes={{ 'data-node-probe-anchor': true }}
          dotEnterAnimation={reduced ? undefined : CONNECTOR_DOT_ENTER}
        />
        <NodeSelfCard
          node={node}
          chain={chain}
          peers={peers}
          layoutSide={layoutSide}
          sighting={sighting}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
