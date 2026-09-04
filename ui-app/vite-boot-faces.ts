import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/**
 * The boot shell's faces, in the document head.
 *
 * The page's first second used to set one word — STAGE POWER-ON — in THREE
 * typefaces (report E, E-2): the shell drew it in the OS monospace, the first
 * HUD commit drew it in `system-ui` because `injectHudTheme` runs in a
 * `useEffect` and the `@font-face` rules did not exist yet, and the third
 * frame drew it in Saira once seven hashed woff2 had been fetched. Nothing
 * preloaded them, so the fetch could not even start during the one to five
 * seconds the snapshot takes — the only idle network the page ever has.
 *
 * So this plugin puts the two boot faces' `@font-face` and a `<link
 * rel="preload">` for each into the head at build and in dev, and the shell in
 * `index.html` names the same families the React band will. The download
 * starts with the document; the shell, the band and the HUD are one face.
 *
 * ⚠️ IT DOES NOT EMIT THE FONTS. `hudTheme.ts` imports all seven, so Vite
 * already emits them with content hashes; this reads the names back out of
 * the bundle rather than emitting a second copy under a second hash. In dev
 * there is no bundle and no hash, and the file is served from the workspace
 * over `/@fs/`.
 *
 * Only the two the shell actually sets. A preload for a face the first paint
 * does not use is a request competing with the snapshot for the same
 * connection, which is the opposite of the fix.
 */
const FONT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/ui/src/fonts',
);

interface BootFace {
  /** The `font-family` the shell and `hudTheme.ts` both name. */
  family: string;
  /** The source file, as it sits in `packages/ui/src/fonts`. */
  file: string;
  /** The `font-weight` descriptor, matching `hudTheme.ts`'s own `@font-face`
   *  exactly — two faces registered for one family under two weight ranges is
   *  a face the browser has to choose between. */
  weight: string;
}

/** The band's title, its trail, and the ◇ that stands between them. Saira is
 *  the title's face in `HUD_FONTS.display`, Share Tech Mono the trail's in
 *  `HUD_FONTS.mono`, and the diamond exists in neither of them — it is the
 *  one glyph the HUD's own JetBrains subset is carried for, and without it the
 *  shell draws a mark from whatever the OS has. */
export const BOOT_FACES: readonly BootFace[] = [
  { family: 'Saira', file: 'Saira-latin.woff2', weight: '100 900' },
  { family: 'Share Tech Mono', file: 'ShareTechMono-latin.woff2', weight: '400' },
  { family: 'JetBrains Mono Local', file: 'JetBrainsMono-400-subset.woff2', weight: '400' },
];

/** Where a face's bytes will be, once. In a build the emitted asset carries a
 *  content hash and the bundle is the only place that knows it; in dev Vite
 *  serves the workspace file itself. */
function faceUrl(face: BootFace, bundle: Record<string, unknown> | undefined, base: string): string {
  if (bundle) {
    for (const [fileName, output] of Object.entries(bundle)) {
      const asset = output as { type?: string; names?: string[]; originalFileNames?: string[]; name?: string };
      if (asset.type !== 'asset') continue;
      const named = [...(asset.names ?? []), ...(asset.originalFileNames ?? []), asset.name ?? '']
        .some((candidate) => candidate.endsWith(face.file));
      if (named) return `${base.replace(/\/$/, '')}/${fileName}`;
    }
    throw new Error(`boot face ${face.file} is not in the bundle — hudTheme.ts stopped importing it`);
  }
  if (!readdirSync(FONT_DIR).includes(face.file)) {
    throw new Error(`boot face ${face.file} is not in packages/ui/src/fonts`);
  }
  return `/@fs${resolve(FONT_DIR, face.file)}`;
}

/** The head tags for one resolved set of URLs. Split out so a test can read
 *  what the plugin writes without running Vite. */
export function bootFaceTags(urls: readonly string[]): HtmlTagDescriptor[] {
  const preloads: HtmlTagDescriptor[] = urls.map((href) => ({
    tag: 'link',
    attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href, crossorigin: '' },
    // Appended rather than prepended: `<meta charset>` has to land inside
    // the document's first 1,024 bytes, and three preload links plus three
    // `@font-face` rules in front of it is 700 of them. The preload scanner
    // reads the whole head before layout either way.
    injectTo: 'head',
  }));
  // `font-display: optional`, which is the descriptor that says what this
  // plugin is for. The HUD's own faces are `swap` and should be — a panel
  // that arrives in a fallback and corrects itself beats a panel that is
  // blank. The shell is not a panel: it is ONE LINE that is on screen for a
  // second, and a face arriving after it has been read is a flicker rather
  // than an improvement. `optional` gives the preloaded bytes a 100 ms race
  // and NO swap period after it — so the band is one typeface either way,
  // which is the property being bought. `block` would buy it too and pay in
  // invisible text on a slow connection, which is worse than the wrong face.
  const faces = BOOT_FACES.map((face, index) =>
    `@font-face{font-family:'${face.family}';font-weight:${face.weight};`
    + `font-display:optional;src:url("${urls[index]}") format("woff2")}`).join('');
  return [
    ...preloads,
    { tag: 'style', attrs: { 'data-boot-faces': 'true' }, children: faces, injectTo: 'head' },
  ];
}

export function bootFaces(): Plugin {
  return {
    name: 'cknerv-boot-faces',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const base = ctx.server ? '/' : (ctx.path.startsWith('/') ? '/' : '');
        return bootFaceTags(
          BOOT_FACES.map((face) => faceUrl(face, ctx.bundle as Record<string, unknown> | undefined, base)),
        );
      },
    },
  };
}
