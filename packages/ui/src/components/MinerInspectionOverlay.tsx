import {
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import MinerNodeCard, {
  MINER_NODE_ACCENT,
  MINER_NODE_SPOKEN_WORD,
  minerKeyHead,
  type MinerNodeSubject,
} from './hud/MinerNodeCard';
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

/** The shortest of the four dialects — a header, two chain facts, the declared
 *  build with its join, and one honesty line — so it places by its own small
 *  box until the card has been measured. */
const DEFAULT_CARD_WIDTH_PX = 340;
const DEFAULT_CARD_HEIGHT_PX = 300;

/** Entering the connector dot is chassis behaviour rather than a cell one —
 *  the keyframe lives in the shared HUD theme, injected once app-wide. */
const CONNECTOR_DOT_ENTER =
  'cknerv-cell-detail-anchor-enter 360ms cubic-bezier(.2,.82,.2,1) both';

export type MinerInspectionHandles = SceneInspectionHandles;

export function createMinerInspectionHandles(): MinerInspectionHandles {
  return createSceneInspectionHandles({
    defaultSize: {
      width: DEFAULT_CARD_WIDTH_PX,
      height: DEFAULT_CARD_HEIGHT_PX,
    },
    // No facets and no lost state on this dialect either — and no link that
    // could be lost, so the tier's own scaffold cyan holds for as long as the
    // card is open.
    accent: MINER_NODE_ACCENT,
    placementDataKey: 'minerProbePlacement',
    connectorDataKey: 'minerProbeConnectorDirection',
  });
}

/**
 * Scene half of the miner probe: the shared anchor at the producer's staged
 * point in the colony, mounted through NetworkColony's overlay slot so it reads
 * colony space — the same slot the other two colony dialects use, and only ever
 * one of them at a time, because the selection is single. Like its siblings it
 * hangs nothing off the frame: the projected point only moves the card and its
 * connector.
 */
export function MinerInspectionAnchor({
  position,
  handles,
}: {
  position: Vec3;
  handles: MinerInspectionHandles;
}) {
  return <SceneInspectionAnchor position={position} handles={handles} />;
}

export interface MinerInspectionOverlayProps {
  handles: MinerInspectionHandles;
  /** The producer standing behind the clicked node, resolved from the LIVE
   *  producer view together with the denominator its build share is measured
   *  against — never from the standing hanging off the staged node, which is
   *  the one captured at the last producer key-set change. */
  subject: MinerNodeSubject;
  onClose: () => void;
}

/**
 * Miner probe — the DOM half. A Canvas sibling, so pointer events inside the
 * card never reach the R3F root and the colony's own selection raycasts stay
 * untouched.
 *
 * No retention epilogue and no promotion path, unlike the two dialects beside
 * it. Nothing here is linked, so nothing can be lost; and a producer cannot be
 * discovered into a richer dialect either, because knowing WHICH machine it is
 * is exactly the thing this evidence class does not carry. A producer leaves
 * this card one way — its last block rolls out of the window — and the
 * selection ends with it.
 */
export default function MinerInspectionOverlay({
  handles,
  subject,
  onClose,
}: MinerInspectionOverlayProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const producerKey = subject.producer.key;
  // Render-time write into the mutable channel, as the sibling dialects do.
  // This card has no facets and no lost state, so the tether holds the tier's
  // own cyan for exactly as long as the card is open.
  handles.accent = MINER_NODE_ACCENT;
  const layoutSide = useSceneInspectionLayoutSide(handles);
  useSceneInspectionDismiss(cardRef, onClose);

  // The sticky offset belongs to one selection: opening a different producer
  // clears the lock, so its card centres itself afresh beside it.
  useEffect(() => {
    resetInspectionPlacementLock(handles);
  }, [producerKey, handles]);

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
  }, [producerKey, handles]);

  return (
    <div
      data-miner-probe-layer
      style={INSPECTION_LAYER_STYLE}
    >
      <div
        ref={cardRef}
        data-miner-probe-overlay
        data-miner-probe-dismiss-boundary="true"
        data-miner-probe-producer={producerKey}
        role="region"
        aria-label={`${MINER_NODE_SPOKEN_WORD} ${minerKeyHead(producerKey)} inspection`}
        style={INSPECTION_CARD_STYLE}
      >
        <SceneInspectionConnector
          handles={handles}
          leaderAttributes={{ 'data-miner-probe-leader': true }}
          dotAttributes={{ 'data-miner-probe-anchor': true }}
          dotEnterAnimation={reduced ? undefined : CONNECTOR_DOT_ENTER}
        />
        <MinerNodeCard
          subject={subject}
          layoutSide={layoutSide}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
