import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { completeBootPhase } from './bootSequence';
import {
  createFirstLightDetector,
  type FirstLightDetector,
} from './firstLightDetector';
import { kickBootShaderPrecompile } from './shaderPrecompile';

/**
 * Reports first light to the boot record: the one phase only the render loop
 * can witness. That same moment is the earliest honest proof the renderer can
 * draw, so the scene's shader precompile is kicked from it.
 *
 * Must live under the r3f context and mount exactly once (SimClockTicker's
 * discipline). Default priority — a positive one would take the render loop
 * away from R3F, and this component draws nothing.
 *
 * `populated` says whether the stage has anything on it; a perfectly steady
 * loop over an empty field is not a lit galaxy. It is a boolean rather than a
 * count so the sentinel re-renders once, when the seeded cache lands, instead
 * of on every generation the stream flushes.
 */
export default function BootFrameSentinel({ populated }: {
  populated: boolean;
}): null {
  const detectorRef = useRef<FirstLightDetector | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = createFirstLightDetector();
  }
  const detector = detectorRef.current;
  useFrame((state, delta) => {
    // Inert for the rest of the session after the latch; the phase is
    // terminal in the record too, so nothing downstream re-reads this.
    if (detector.lit) return;
    if (!detector.frame(delta, populated)) return;
    completeBootPhase('first_light');
    // The loop is proven, so the renderer is genuinely alive: the programs
    // nothing has drawn yet can link against the rest of the readout instead
    // of against the visitor's first gesture. Deferred out of this callback
    // and one-shot on its own module, so neither the phase above nor the
    // frame carrying it pays for it.
    kickBootShaderPrecompile(state.gl, state.scene, state.camera);
  });
  return null;
}
