import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Peer } from '@cknerv/types';
import PeerLinkCard from './hud/PeerLinkCard';
import type { PeerSightingState } from './hud/PeerSightingPlate';
import type { PeerMiningCandidacy } from '../derives/blockProducers.derive';
import { HUD_COLORS } from './hud/hudTheme';
import { useReducedMotion } from './hud/useReducedMotion';
import {
  selectedPeerLinkAccent,
  type PeerLinkFacet,
} from '../derives/peerLinkInstrument.derive';
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
  useSceneInspectionExit,
  useSceneInspectionLayoutSide,
  type SceneInspectionHandles,
} from './sceneInspection';
import { useHudOcclusionRects } from './hudOcclusion';

/** The probe is a readout beside its node, not a specimen scan: it places by
 *  the card's own 340px column and a typical plate stack until measured. */
const DEFAULT_CARD_WIDTH_PX = 340;
const DEFAULT_CARD_HEIGHT_PX = 460;

export type PeerInspectionHandles = SceneInspectionHandles;

export function createPeerInspectionHandles(): PeerInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: {
      width: DEFAULT_CARD_WIDTH_PX,
      height: DEFAULT_CARD_HEIGHT_PX,
    },
    // The link's own plane. The render pass replaces it with the measured
    // node's tint (or caution, on a lost link) as soon as the card mounts.
    accent: HUD_COLORS.peerWire,
    placementDataKey: 'peerProbePlacement',
    connectorDataKey: 'peerProbeConnectorDirection',
  });
}

/**
 * Scene half of the link probe: the shared anchor at the peer's colony node,
 * mounted through NetworkColony's overlay slot so it reads colony space. The
 * peer dialect hangs nothing off the frame — there is no portrait channel, so
 * the projected point only ever moves the card and its connector.
 */
export function PeerInspectionAnchor({
  position,
  handles,
}: {
  position: Vec3;
  handles: PeerInspectionHandles;
}) {
  const obstacles = useHudOcclusionRects();
  return (
    <SceneInspectionAnchor
      position={position}
      handles={handles}
      obstacles={obstacles}
    />
  );
}

export interface PeerInspectionOverlayProps {
  handles: PeerInspectionHandles;
  peer: Peer;
  /** Local chain tip the sync ladder measures the peer against. */
  tip: number;
  /** Our own client version — the reference every mismatch is judged from. */
  localVersion: string;
  /** The peer has left `peers[]`; this is a retained snapshot in its epilogue. */
  linkLost: boolean;
  /** The crawler's dossier on this node, when the source can offer one. It
   *  outlives the link: a dropped connection says nothing about how the rest
   *  of the network last saw the node at the other end. */
  sighting?: PeerSightingState;
  /** Whether this peer runs a build one of the chain's recent producers
   *  declared — a chain fact joined against the crawler's roster, resolved by
   *  the host off the LIVE producer view. */
  candidacy?: PeerMiningCandidacy | null;
  /** The dialect is closing and the chassis owes the card its exit — see
   *  `useSceneInspectionExit`. */
  leaving?: boolean;
  onClose: () => void;
}

/**
 * Peer-tethered link probe — the DOM half. A Canvas sibling, so pointer events
 * inside the card never reach the R3F root and the colony's own selection
 * raycasts stay untouched. The card keeps the clicked node visible and claims
 * only one screen-space tie to it, the same grammar the Cell scan uses in its
 * own dialect.
 */
export default function PeerInspectionOverlay({
  handles,
  peer,
  tip,
  localVersion,
  linkLost,
  sighting,
  candidacy,
  leaving = false,
  onClose,
}: PeerInspectionOverlayProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [focusFacet, setFocusFacet] = useState<PeerLinkFacet | null>(null);
  // Render-time write into the mutable channel: the anchor folds the accent
  // into its frame signature, so selecting a fact re-tints the connector on
  // the next frame without any React coupling between the two trees. A lost
  // link has no colour of its own left to speak, so the tether goes caution
  // with the card rather than still describing a link that ended.
  handles.accent = linkLost
    ? HUD_COLORS.caution
    : selectedPeerLinkAccent({ peer, tip, localVersion }, focusFacet);
  const layoutSide = useSceneInspectionLayoutSide(handles);
  const handleFacetChange = useCallback((facet: PeerLinkFacet | null) => {
    setFocusFacet(facet);
  }, []);
  useSceneInspectionDismiss(cardRef, onClose);
  useSceneInspectionExit(handles, cardRef, leaving, reduced);

  // The sticky offset belongs to one selection: probing a different peer
  // clears the lock, so its card centres itself afresh beside its own node.
  useEffect(() => {
    resetInspectionPlacementLock(handles);
  }, [peer.node_id, handles]);

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
  }, [peer.node_id, handles]);

  return (
    <div
      data-peer-probe-layer
      data-scene-inspection-layer="true"
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={cardRef}
        data-peer-probe-overlay
        data-peer-probe-dismiss-boundary="true"
        data-peer-probe-node={peer.node_id}
        role="region"
        aria-label={`Peer ${peer.node_id} inspection`}
        style={INSPECTION_CARD_STYLE}
      >
        <SceneInspectionConnector
          handles={handles}
          leaderAttributes={{ 'data-peer-probe-leader': true }}
          dotAttributes={{ 'data-peer-probe-anchor': true }}
        />
        <PeerLinkCard
          peer={peer}
          tip={tip}
          localVersion={localVersion}
          layoutSide={layoutSide}
          linkLost={linkLost}
          sighting={sighting}
          candidacy={candidacy}
          onFacetChange={handleFacetChange}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
