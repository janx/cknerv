import {
  type MutableRefObject,
  useEffect,
  useMemo,
} from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import { consensusBraidPathPoint } from '../../derives/consensusBraid.derive';
import type { CellMorphologyTopology, MorphologyPoint3 } from '../../derives/cellMorphology.derive';
import type { CellSemanticMorphologyOverlay } from '../../derives/cellSemanticMorphology.derive';
import { CELL_PORTRAIT_LABEL_PORTAL } from './cellPortraitInsetChannel';
import { SEGMENT_COLORS } from './cellFormat';
import { QUALITATIVE_BUCKET_COLORS } from './hudTheme';
import {
  cellSemanticKnowledgeArcWindow,
  cellSemanticKnowledgeRingVisible,
} from './cellSemanticMorphologyOverlay.presentation';

/** The occupied-byte ring says the same four words the dossier's byte bar and
 *  the stage's composition orbit say — capacity, lock, type, data — so it reads
 *  from the table both of those already read. It kept a private copy for the
 *  life of this overlay, which made this the THIRD spelling of one
 *  decomposition, and the copy had drifted the way copies do: its capacity arc
 *  sat 14.0 from chrome orange and its data arc 39.2 from `warning`, so a
 *  Cell's ordinary byte split was painted in the instrument's own frame colour
 *  and in an alarm tone.
 *
 *  The names differ by one word — the ring calls the first axis `capacity` and
 *  the bar calls it `cap` — so the mapping is written down rather than assumed.
 *
 *  Taken as the token's own value, not a brightened derivation of it: there is
 *  no bloom pass in this app (no `EffectComposer`, no `postprocessing`
 *  dependency), and `SEGMENT_COLORS` is ALREADY drawn as an additive,
 *  `toneMapped={false}` scene material by `CellSemanticOrbit` — the composition
 *  ring around the selected Cell on stage. Two of the three surfaces that
 *  decompose a Cell were already agreeing in this medium at these values; a
 *  private scene-side treatment here would put the third back out of step for
 *  a legibility problem the other two do not have. */
const KNOWLEDGE_SEGMENT_KEY = {
  capacity: 'cap',
  lock: 'lock',
  type: 'type',
  data: 'data',
} as const;

/** A byte segment's colour is handed out by a hash of its label — a slot index
 *  that means nothing, which is exactly what the house's qualitative ramp is
 *  for. The private four it kept instead had two members inside the reserve:
 *  one 9.8 from `cellRose`, so a stretch of a Cell's bytes was painted in the
 *  colour that names the Cell organism itself, and one 39.2 from `warning`. */
function dataSegmentColor(colorIndex: number): string {
  return QUALITATIVE_BUCKET_COLORS[colorIndex % QUALITATIVE_BUCKET_COLORS.length];
}

/** A facet glyph is not one of the four byte axes and has no band of its own:
 *  DAO, dep group and code cell are marked as a set, in one warm point. Written
 *  once here because it is drawn twice — as the point in the scene and as the
 *  label beside it — and one colour typed twice is how the table above drifted.
 */
const ROLE_GLYPH_COLOR = '#fef3c7';

function radialOffset(point: MorphologyPoint3, amount: number): MorphologyPoint3 {
  const magnitude = Math.hypot(point[0], point[1], point[2]);
  const direction = magnitude > 1e-8
    ? [point[0] / magnitude, point[1] / magnitude, point[2] / magnitude]
    : [0, 1, 0];
  return [
    point[0] + direction[0] * amount,
    point[1] + direction[1] * amount,
    point[2] + direction[2] * amount,
  ];
}

function pushSegment(
  positions: number[],
  colors: number[],
  from: MorphologyPoint3,
  to: MorphologyPoint3,
  color: THREE.Color,
): void {
  positions.push(...from, ...to);
  colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function buildOverlayGeometry(
  topology: CellMorphologyTopology,
  overlay: CellSemanticMorphologyOverlay,
): {
  lineGeometry: THREE.BufferGeometry;
  knowledgeGeometry: THREE.BufferGeometry;
  pointGeometry: THREE.BufferGeometry;
} {
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const knowledgePositions: number[] = [];
  const knowledgeColors: number[] = [];
  const pointPositions: number[] = [];
  const pointColors: number[] = [];
  const boundaryKeys = new Set<string>();

  for (const segment of overlay.dataSegments) {
    const color = new THREE.Color(dataSegmentColor(segment.colorIndex));
    const span = Math.max(0, segment.end - segment.start);
    const steps = Math.max(1, Math.min(16, Math.ceil(span * 32)));
    for (let index = 0; index < steps; index += 1) {
      const start = segment.start + span * index / steps;
      const end = segment.start + span * (index + 1) / steps;
      pushSegment(
        linePositions,
        lineColors,
        radialOffset(consensusBraidPathPoint(topology.carrier, start), 0.09),
        radialOffset(consensusBraidPathPoint(topology.carrier, end), 0.09),
        color,
      );
    }
    for (const [byte, parameter] of [
      [segment.startByte, segment.start],
      [segment.endByte, segment.end],
    ] as const) {
      const key = `${byte}/${parameter}`;
      if (boundaryKeys.has(key)) continue;
      boundaryKeys.add(key);
      const carrier = consensusBraidPathPoint(topology.carrier, parameter);
      const inner = radialOffset(carrier, 0.055);
      const outer = radialOffset(carrier, 0.135);
      pushSegment(linePositions, lineColors, inner, outer, color);
      pointPositions.push(...outer);
      pointColors.push(color.r, color.g, color.b);
    }
  }

  // Occupied-byte explanation lives on its own planar arc: it can disappear
  // with enrichment without altering any canonical carrier or strand point.
  for (const segment of overlay.knowledgeSegments) {
    const window = cellSemanticKnowledgeArcWindow(segment);
    if (!window) continue;
    const color = new THREE.Color(
      SEGMENT_COLORS[KNOWLEDGE_SEGMENT_KEY[segment.role]],
    );
    const span = window.end - window.start;
    const steps = Math.max(1, Math.ceil(span * 32));
    for (let index = 0; index < steps; index += 1) {
      const a0 = (window.start + span * index / steps) * Math.PI * 2;
      const a1 = (window.start + span * (index + 1) / steps) * Math.PI * 2;
      pushSegment(
        knowledgePositions,
        knowledgeColors,
        [Math.cos(a0) * 0.9, Math.sin(a0) * 0.9, -0.62],
        [Math.cos(a1) * 0.9, Math.sin(a1) * 0.9, -0.62],
        color,
      );
    }
  }

  for (const glyph of overlay.roleGlyphs) {
    const color = new THREE.Color(ROLE_GLYPH_COLOR);
    const point = radialOffset(
      consensusBraidPathPoint(topology.carrier, glyph.parameter),
      0.17,
    );
    pointPositions.push(...point);
    pointColors.push(color.r, color.g, color.b);
  }

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(linePositions, 3),
  );
  lineGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(lineColors, 3),
  );
  lineGeometry.computeBoundingSphere();
  const knowledgeGeometry = new THREE.BufferGeometry();
  knowledgeGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(knowledgePositions, 3),
  );
  knowledgeGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(knowledgeColors, 3),
  );
  knowledgeGeometry.computeBoundingSphere();
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(pointPositions, 3),
  );
  pointGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(pointColors, 3),
  );
  pointGeometry.computeBoundingSphere();
  return { lineGeometry, knowledgeGeometry, pointGeometry };
}

/** Optional selected-portrait annotation layer. The base topology is read-only
 * input and owns no dependency on this component or its lifecycle. */
export default function CellSemanticMorphologyOverlay({
  topology,
  overlay,
  focusField,
}: {
  topology: CellMorphologyTopology;
  overlay: CellSemanticMorphologyOverlay;
  focusField: ConsensusBraidField | null;
}) {
  const built = useMemo(
    () => buildOverlayGeometry(topology, overlay),
    [overlay, topology],
  );
  useEffect(() => () => {
    built.lineGeometry.dispose();
    built.knowledgeGeometry.dispose();
    built.pointGeometry.dispose();
  }, [built]);
  const lineCount = built.lineGeometry.getAttribute('position').count;
  const knowledgeCount = built.knowledgeGeometry.getAttribute('position').count;
  const pointCount = built.pointGeometry.getAttribute('position').count;
  const opacity = focusField === 'data' || focusField === 'capacity' ? 0.96 : 0.58;
  const showKnowledgeRing = cellSemanticKnowledgeRingVisible(focusField);
  const labels = [
    ...overlay.scriptLabels.map((label) => ({
      key: `script/${label.role}`,
      role: label.role.toUpperCase(),
      text: label.text,
      parameter: label.parameter,
      color: label.role === 'lock' ? SEGMENT_COLORS.lock : SEGMENT_COLORS.type,
    })),
    ...overlay.roleGlyphs.map((glyph) => ({
      key: `role/${glyph.role}/${glyph.parameter}`,
      role: glyph.role.replaceAll('_', ' ').toUpperCase(),
      text: glyph.label,
      parameter: glyph.parameter,
      color: ROLE_GLYPH_COLOR,
    })),
  ];

  return (
    <group name={`semantic-morphology/${overlay.fingerprint}`} renderOrder={9}>
      {lineCount > 0 ? (
        <lineSegments geometry={built.lineGeometry} frustumCulled={false}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={opacity}
            blending={THREE.AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      ) : null}
      {showKnowledgeRing && knowledgeCount > 0 ? (
        <lineSegments
          name="semantic-occupied-byte-ring"
          geometry={built.knowledgeGeometry}
          frustumCulled={false}
        >
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={focusField === 'capacity' ? 0.9 : 0.72}
            blending={THREE.AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      ) : null}
      {pointCount > 0 ? (
        <points geometry={built.pointGeometry} frustumCulled={false}>
          <pointsMaterial
            vertexColors
            size={0.024}
            transparent
            opacity={opacity}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      ) : null}
      {labels.map((label) => {
        const path = label.key === 'script/lock'
          ? topology.strands[0]?.points ?? topology.carrier
          : topology.carrier;
        return (
          <Html
            key={label.key}
            position={radialOffset(
              consensusBraidPathPoint(path, label.parameter),
              0.22,
            )}
            zIndexRange={[4, 4]}
            occlude={false}
            portal={CELL_PORTRAIT_LABEL_PORTAL as MutableRefObject<HTMLElement>}
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-cell-semantic-morphology-label={label.key}
              style={{
                padding: '1px 3px',
                borderLeft: `1px solid ${label.color}`,
                background: 'rgba(0,3,12,.78)',
                boxShadow: `0 0 7px ${label.color}44`,
                color: label.color,
                fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
                fontSize: 6,
                lineHeight: 1.15,
                letterSpacing: 0.35,
                whiteSpace: 'nowrap',
              }}
            >
              {label.role} · {label.text}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
