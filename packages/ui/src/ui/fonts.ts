/**
 * Font URLs for troika-three-text `<Text>` and CSS overlays.
 *
 * Vite resolves these as hashed URLs at build time; in dev mode they
 * stream straight from `src/fonts/`. Troika supports only TTF / OTF /
 * WOFF — WOFF2 is intentionally avoided here.
 *
 * - `MONO`     — body / log lines / event detail (JetBrains Mono Regular)
 * - `MONO_BOLD`— numeric counters (JetBrains Mono Medium)
 * - `DISPLAY`  — section headers (Orbitron Medium, geometric all-caps)
 */

import jbmRegular from '../fonts/JetBrainsMono-Regular.ttf';
import jbmMedium from '../fonts/JetBrainsMono-Medium.ttf';
import orbitronMedium from '../fonts/Orbitron-Medium.ttf';

export const FONT_MONO: string = jbmRegular;
export const FONT_MONO_BOLD: string = jbmMedium;
export const FONT_DISPLAY: string = orbitronMedium;
