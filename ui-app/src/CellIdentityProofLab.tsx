import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';
import {
  CELLS_Y,
  CHAIN_Y,
  CellGalaxy,
  CellGalaxyProvider,
  QUALITY_PRESETS,
  SimClockScope,
  SimClockTicker,
  createSimClock,
  useQualityRuntime,
  type CellIdentityProofEvent,
  type CellIdentityProofKind,
} from '@cknerv/ui';
import Tweaks from './Tweaks';
import {
  CELL_IDENTITY_PROOF_REVIEW_KINDS,
  CELL_IDENTITY_PROOF_REVIEW_STAGES,
  cellIdentityProofReviewFrame,
  resolveCellIdentityProofReviewStage,
} from './cell-identity-proof-lab-state';
import { selectInitialLabCell } from './cell-form-lab-selection';
import { resolveCanvasDpr } from './render-quality';

const PROOF_META: Record<CellIdentityProofKind, {
  code: 'WHERE' | 'WHAT' | 'WHEN';
  name: string;
  cjk: string;
  thesis: string;
  color: string;
  x: number;
  cameraY: number;
  targetY: number;
}> = {
  address: {
    code: 'WHERE',
    name: 'OUTPOINT LOCATOR',
    cjk: '位置证明',
    thesis: 'transaction output / exact scene location',
    color: '#9DF7FF',
    x: -2.8,
    cameraY: CELLS_Y,
    targetY: CELLS_Y,
  },
  content: {
    code: 'WHAT',
    name: 'CONTENT SIGNATURE',
    cjk: '内容证明',
    thesis: 'content hash / stable information identity',
    color: '#C7A7FF',
    x: 0,
    cameraY: CELLS_Y,
    targetY: CELLS_Y,
  },
  anchor: {
    code: 'WHEN',
    name: 'BIRTH ANCHOR',
    cjk: '时序证明',
    thesis: 'birth block / shared chain chronology',
    color: '#FFD48C',
    x: 2.2,
    cameraY: (CELLS_Y + CHAIN_Y) * 0.5,
    targetY: (CELLS_Y + CHAIN_Y) * 0.5,
  },
};

const STAGE_META = {
  entry: {
    code: '01',
    label: 'ENTRY',
    thesis: 'geometry arrives before explanation',
  },
  key: {
    code: '02',
    label: 'KEY FRAME',
    thesis: 'proof form and exact evidence coexist',
  },
  late: {
    code: '03',
    label: 'RESOLVE',
    thesis: 'the form closes while identity remains legible',
  },
  reduced: {
    code: '04',
    label: 'REDUCED',
    thesis: 'complete static proof without simulated motion',
  },
} as const;

function proofEvidence(cell: Cell, kind: CellIdentityProofKind): string {
  if (kind === 'address') {
    return `${cell.out_point.tx_hash.slice(0, 10)}…${
      cell.out_point.tx_hash.slice(-8)
    }#${cell.out_point.index}`;
  }
  if (kind === 'anchor') return `BLOCK #${cell.birth_block}`;
  return `${cell.content_hash.slice(0, 14)}…${cell.content_hash.slice(-10)}`;
}

function ReviewReady({ onReady }: { onReady: () => void }) {
  const framesRef = useRef(0);
  useFrame(() => {
    framesRef.current += 1;
    if (framesRef.current === 2) onReady();
  });
  return null;
}

function ProofCamera({ targetY }: { targetY: number }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
    camera.updateWorldMatrix(true, false);
  }, [camera, targetY]);
  return null;
}

function ProofPanel({
  cell,
  kind,
  stage,
  dpr,
  onReady,
}: {
  cell: Cell;
  kind: CellIdentityProofKind;
  stage: ReturnType<typeof resolveCellIdentityProofReviewStage>;
  dpr: number;
  onReady: () => void;
}) {
  const meta = PROOF_META[kind];
  const frame = cellIdentityProofReviewFrame(stage, kind);
  const reviewCell = useMemo<Cell>(() => ({
    ...cell,
    pos_seed: [meta.x, 0, 0],
  }), [cell, meta.x]);
  const cache = useMemo(() => fromCellsSnapshot(1, {
    cells: [reviewCell],
    last_pulse_at_ms: 0,
    recent_links: [],
  }), [reviewCell]);
  const event = useMemo<CellIdentityProofEvent>(() => ({
    kind,
    cellId: reviewCell.id,
    sequence: CELL_IDENTITY_PROOF_REVIEW_KINDS.indexOf(kind) + 1,
    emittedAtMs: 0,
    reducedMotion: frame.reducedMotion,
  }), [frame.reducedMotion, kind, reviewCell.id]);
  const clock = useMemo(() => createSimClock(), []);
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef(false);
  const flashDirtyIdsRef = useRef<Set<number>>(new Set());

  return (
    <article
      data-cell-proof-kind={kind}
      data-cell-proof-code={meta.code}
      data-cell-proof-sample={frame.elapsedSeconds.toFixed(2)}
      data-cell-proof-reduced={frame.reducedMotion ? 'true' : 'false'}
      style={{
        minWidth: 0,
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: '58px minmax(0, 1fr) 72px',
        overflow: 'hidden',
        border: `1px solid ${meta.color}2b`,
        background: 'rgba(2, 5, 14, 0.82)',
        boxShadow: `inset 0 0 40px ${meta.color}09`,
      }}
    >
      <header style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 14,
        padding: '12px 13px 8px',
        boxSizing: 'border-box',
        borderBottom: `1px solid ${meta.color}1f`,
      }}>
        <div>
          <div style={{
            color: meta.color,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.17em',
            textShadow: `0 0 12px ${meta.color}55`,
          }}>
            {meta.code} / {meta.name}
          </div>
          <div style={{
            marginTop: 5,
            color: '#617086',
            fontSize: 7,
            letterSpacing: '0.08em',
          }}>
            {meta.thesis.toUpperCase()}
          </div>
        </div>
        <span style={{
          color: meta.color,
          opacity: 0.72,
          fontSize: 8,
          letterSpacing: '0.08em',
        }}>
          {meta.cjk}
        </span>
      </header>

      <div style={{
        position: 'relative',
        minHeight: 0,
        background: `
          radial-gradient(circle at 50% 38%, ${meta.color}0d, transparent 38%),
          linear-gradient(rgba(93, 121, 154, .035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(93, 121, 154, .035) 1px, transparent 1px),
          #02030a
        `,
        backgroundSize: 'auto, 28px 28px, 28px 28px, auto',
      }}>
        <CellGalaxyProvider value={cache}>
          <Canvas
            camera={{
              position: [0, meta.cameraY, 34],
              fov: 40,
              near: 0.1,
              far: 240,
            }}
            dpr={dpr}
            frameloop="always"
            gl={{ antialias: true, alpha: true }}
            style={{ background: 'transparent' }}
          >
            <SimClockScope
              clock={clock}
              paused={false}
              timeScale={1}
              fixedDeltaSec={0}
            >
              <SimClockTicker />
              <ProofCamera targetY={meta.targetY} />
              <ReviewReady onReady={onReady} />
              <CellGalaxy
                ckbNodeIds={[]}
                universeSeed={0x434b42}
                selectedId={null}
                selectedCellId={`cell:${reviewCell.id}`}
                identityProof={event}
                identityProofSampleElapsedSeconds={frame.elapsedSeconds}
                onSelect={() => undefined}
                cellFlashRef={cellFlashRef}
                flashDirtyRef={flashDirtyRef}
                flashDirtyIdsRef={flashDirtyIdsRef}
              />
            </SimClockScope>
          </Canvas>
        </CellGalaxyProvider>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 1,
            background: `linear-gradient(transparent, ${meta.color}16, transparent)`,
            pointerEvents: 'none',
          }}
        />
      </div>

      <footer style={{
        padding: '10px 13px',
        boxSizing: 'border-box',
        borderTop: `1px solid ${meta.color}1f`,
        fontSize: 7.5,
        lineHeight: 1.6,
        letterSpacing: '0.07em',
      }}>
        <div style={{ color: '#D9F8FF' }}>{proofEvidence(cell, kind)}</div>
        <div style={{ color: '#536277' }}>
          SAMPLE {frame.elapsedSeconds.toFixed(2)}S · CELL #{cell.id}
          {frame.reducedMotion ? ' · STATIC' : ' · FIXED ELAPSED'}
        </div>
      </footer>
    </article>
  );
}

export default function CellIdentityProofLab({
  snapshot,
}: {
  snapshot: CellGalaxySnapshot;
}) {
  const stage = resolveCellIdentityProofReviewStage(window.location.search);
  const stageMeta = STAGE_META[stage];
  const selected = selectInitialLabCell(snapshot, window.location.search);
  const { effective: quality } = useQualityRuntime();
  const canvasDpr = resolveCanvasDpr(
    window.devicePixelRatio,
    QUALITY_PRESETS[quality].maxDpr,
  );
  const [readyKinds, setReadyKinds] = useState<Set<CellIdentityProofKind>>(
    () => new Set(),
  );
  const markReady = useCallback((kind: CellIdentityProofKind) => {
    setReadyKinds((current) => {
      if (current.has(kind)) return current;
      const next = new Set(current);
      next.add(kind);
      return next;
    });
  }, []);

  if (!selected) {
    return <pre style={{ color: '#f88', padding: 20 }}>No Cell data available.</pre>;
  }

  const stageHref = (nextStage: typeof stage): string => {
    const params = new URLSearchParams(window.location.search);
    params.set('cell-proof-lab', '1');
    params.set('stage', nextStage);
    return `?${params.toString()}`;
  };

  return (
    <main
      data-cell-proof-review="true"
      data-review-ready={
        readyKinds.size === CELL_IDENTITY_PROOF_REVIEW_KINDS.length
          ? 'true'
          : 'false'
      }
      data-review-stage={stage}
      data-review-quality={quality}
      data-review-cell={selected.id}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        padding: '18px 18px 16px',
        boxSizing: 'border-box',
        background: `
          radial-gradient(circle at 50% 36%, rgba(72, 88, 170, .09), transparent 42%),
          #010207
        `,
        color: '#dbeafe',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    >
      <Tweaks />
      <header style={{
        height: 68,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 24,
        boxSizing: 'border-box',
        borderBottom: '1px solid rgba(125, 211, 252, 0.13)',
      }}>
        <div>
          <div style={{
            color: '#F5C66C',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.23em',
            textShadow: '0 0 16px rgba(245,198,108,.22)',
          }}>
            A / CELL IDENTITY PROOF BASELINE
          </div>
          <div style={{
            marginTop: 7,
            color: '#7DD3FC',
            fontSize: 8,
            letterSpacing: '0.12em',
          }}>
            REAL CKB DATA · NORMALIZED REVIEW POSE · PRODUCTION RENDERERS
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            color: '#C7A7FF',
            fontSize: 9,
            letterSpacing: '0.14em',
          }}>
            {stageMeta.code} / {stageMeta.label}
          </div>
          <div style={{
            marginTop: 5,
            color: '#64748b',
            fontSize: 8,
            letterSpacing: '0.08em',
          }}>
            {stageMeta.thesis.toUpperCase()} · {quality.toUpperCase()}
          </div>
        </div>
      </header>

      <section style={{
        position: 'absolute',
        left: 18,
        right: 18,
        top: 96,
        bottom: 66,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 12,
      }}>
        {CELL_IDENTITY_PROOF_REVIEW_KINDS.map((kind) => (
          <ProofPanel
            key={`${stage}:${kind}:${selected.id}`}
            cell={selected}
            kind={kind}
            stage={stage}
            dpr={canvasDpr}
            onReady={() => markReady(kind)}
          />
        ))}
      </section>

      <nav style={{
        position: 'absolute',
        left: 18,
        bottom: 16,
        display: 'flex',
        gap: 8,
      }}>
        {CELL_IDENTITY_PROOF_REVIEW_STAGES.map((item) => {
          const active = item === stage;
          const meta = STAGE_META[item];
          return (
            <a
              key={item}
              href={stageHref(item)}
              aria-current={active ? 'page' : undefined}
              style={{
                minWidth: 98,
                padding: '7px 9px',
                borderTop: `1px solid ${
                  active ? '#7DD3FC' : 'rgba(125, 211, 252, .14)'
                }`,
                background: active
                  ? 'rgba(12, 18, 38, .76)'
                  : 'rgba(2, 5, 14, .52)',
                color: active ? '#BFEFFF' : '#5E7088',
                textDecoration: 'none',
                fontSize: 7.5,
                letterSpacing: '0.1em',
              }}
            >
              {meta.code} {meta.label}
            </a>
          );
        })}
      </nav>

      <div style={{
        position: 'absolute',
        right: 18,
        bottom: 19,
        color: '#536277',
        fontSize: 7.5,
        letterSpacing: '0.08em',
      }}>
        WHERE / WHAT / WHEN · ONE EVENT OBJECT EACH · NO CHAIN MUTATION
      </div>
    </main>
  );
}
