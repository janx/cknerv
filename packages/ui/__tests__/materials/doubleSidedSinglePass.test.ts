// One rule over every two-sided material in the drawn tree, stated as a source
// sweep for the same reason `windowFreeLibrary` states the package boundary as
// one: nobody reading a material declaration can see what the RENDERER will do
// with it.
//
// ⚠️⚠️ WHAT THE RENDERER DOES. `WebGLRenderer.renderObject` (r169, :1613) and
// `prepareMaterial` (:916) both carry this branch:
//
//     if ( material.transparent === true && material.side === DoubleSide
//          && material.forceSinglePass === false ) {
//       material.side = BackSide;  material.needsUpdate = true;  render();
//       material.side = FrontSide; material.needsUpdate = true;  render();
//       material.side = DoubleSide;
//     } else { render(); }
//
// So a `transparent` + `DoubleSide` material without the flag is TWO draw calls
// per object per frame, and each of them re-resolves the program through
// `getProgram`/`getProgramCacheKey` because `needsUpdate` was set — string
// building, twice per object, sixty times a second, for a picture that is
// identical. The 2026-09-12 review measured it probe-free: 5 `needsUpdate`
// flags per frame at rest, 12+ with a Cell card open, and `getProgram*` at
// 26 ms/s while the card was open.
//
// ⭐ WHY THE FLAG IS SAFE HERE, AND WHERE IT IS NOT FREE. `forceSinglePass`
// does not change which faces are drawn — `side` stays `DoubleSide`, so culling
// stays off and both facings are submitted. It changes only the ORDER within
// one mesh: all back faces then all front faces becomes index order. That is
// invisible for a flat facing (every pixel is covered by one triangle: the
// rings, the plates, the quads, the annuli here), and invisible under additive
// blending at any shape (addition commutes). It is a real ordering choice only
// for a SELF-OVERLAPPING body under normal blending — in this tree the two
// portrait ribbons (`InscribedBraidCore`, `ConsensusMemory`) — which is why
// this task carried an eye gate for them rather than a byte claim.
//
// THE RULE: a `DoubleSide` material declaration carries `forceSinglePass`.
// Not "when transparent" — the flag is inert on an opaque material, so there is
// nothing to weigh, and a rule with a condition in it is a rule somebody has to
// re-derive at the next declaration. If a two-sided material ever wants the two
// passes back, it says so where it is declared (`forceSinglePass: false`) and
// this sweep will point at it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [
  { label: 'packages/ui/src', dir: resolve(process.cwd(), 'src') },
  // The rule is about the drawn tree, and the tree spans two packages. The app
  // declares no material today; the sweep reaches it so that the first one it
  // declares is not outside the only place this rule is written down.
  { label: 'ui-app/src', dir: resolve(process.cwd(), '../../ui-app/src') },
];

interface Source { name: string; text: string }

function readSources(root: string, label: string): Source[] {
  const sources: Source[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path, name);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      sources.push({ name: `${label}/${name}`, text: readFileSync(path, 'utf8') });
    }
  };
  walk(root, '');
  return sources;
}

/** The source with every comment, string and template literal blanked to
 *  spaces, offsets and line breaks preserved.
 *
 *  ⚠️ The walks below count braces and tags, and that is only sound over CODE:
 *  this package's material files carry whole GLSL programs in template
 *  literals, and GLSL has braces of its own. A regex comment-strip is not
 *  enough either — the prose in these files writes `side: THREE.DoubleSide`
 *  and `forceSinglePass` in sentences, and a sweep that reads prose as code
 *  reports sites that do not exist and, worse, flags that are not set. */
function blankLiterals(text: string): string {
  const out = text.split('');
  const blankAt = (index: number): void => {
    if (out[index] !== undefined && out[index] !== '\n') out[index] = ' ';
  };
  interface Frame { mode: 'code' | 'template'; depth: number }
  const stack: Frame[] = [{ mode: 'code', depth: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = stack[stack.length - 1];
    const character = text[i];
    if (frame.mode === 'template') {
      if (character === '\\') { blankAt(i); blankAt(i + 1); i += 2; continue; }
      if (character === '`') { stack.pop(); i += 1; continue; }
      if (character === '$' && text[i + 1] === '{') {
        stack.push({ mode: 'code', depth: 0 });
        i += 2;
        continue;
      }
      blankAt(i);
      i += 1;
      continue;
    }
    if (character === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { blankAt(i); i += 1; }
      continue;
    }
    if (character === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      while (i < stop) { blankAt(i); i += 1; }
      continue;
    }
    if (character === '"' || character === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { blankAt(i); blankAt(i + 1); i += 2; continue; }
        if (text[i] === character) { i += 1; break; }
        if (text[i] === '\n') break;
        blankAt(i);
        i += 1;
      }
      continue;
    }
    if (character === '`') { stack.push({ mode: 'template', depth: 0 }); i += 1; continue; }
    if (character === '{') { frame.depth += 1; i += 1; continue; }
    if (character === '}') {
      if (frame.depth === 0 && stack.length > 1) { stack.pop(); i += 1; continue; }
      frame.depth -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** The `{` that encloses `from`, at brace depth zero. */
function enclosingBrace(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i >= 0; i -= 1) {
    const character = code[i];
    if (character === '}') depth += 1;
    else if (character === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/** The `}` that closes the `{` at `open`. */
function closingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const character = code[i];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

/** The opening tag that owns the JSX attribute at `from`: from its `<` to the
 *  `>` that ends the attribute list. Braces are counted so that an attribute
 *  value's own `{…}` — a `ref={(material) => {…}}` arrow, whose `=>` carries a
 *  `>` of its own — cannot be mistaken for the end of the tag. */
function enclosingTag(code: string, from: number): { start: number; end: number } | null {
  let depth = 0;
  let start = -1;
  for (let i = from; i >= 0; i -= 1) {
    const character = code[i];
    if (character === '}') depth += 1;
    else if (character === '{') depth -= 1;
    else if (character === '<' && depth <= 0) { start = i; break; }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const character = code[i];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return { start, end: i };
  }
  return null;
}

interface Site {
  file: string;
  line: number;
  owner: string;
  span: string;
}

/** Every `DoubleSide` in one source, with the declaration that carries it. */
function doubleSidedSites(file: string, text: string): Site[] {
  const code = blankLiterals(text);
  const sites: Site[] = [];
  const pattern = /(?<![\w$])DoubleSide\b/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const at = match.index;
    const line = code.slice(0, at).split('\n').length;
    const brace = enclosingBrace(code, at);
    if (brace === -1) continue;
    // `side={THREE.DoubleSide}` — a JSX attribute container, whose declaration
    // is the element. `side: THREE.DoubleSide` — an options object, whose
    // declaration is the object literal.
    const before = code.slice(0, brace).replace(/\s+$/, '');
    if (before.endsWith('=')) {
      const tag = enclosingTag(code, brace - 1);
      if (!tag) continue;
      const span = code.slice(tag.start, tag.end + 1);
      const owner = /^<\s*([\w$.]+)/.exec(span)?.[1] ?? 'element';
      sites.push({ file, line, owner: `<${owner}>`, span });
      continue;
    }
    const span = code.slice(brace, closingBrace(code, brace) + 1);
    const callee = /([\w$.]+)\s*\(\s*$/.exec(before)?.[1] ?? 'object';
    sites.push({ file, line, owner: `${callee}({…})`, span });
  }
  return sites;
}

const SET = /\bforceSinglePass\b/;
const CLEARED = /\bforceSinglePass\s*[:=]\s*\{?\s*false\b/;

function offenders(sites: Site[]): string[] {
  return sites
    .filter((site) => !SET.test(site.span) || CLEARED.test(site.span))
    .map((site) => `${site.file}:${site.line} ${site.owner}`);
}

const SITES = ROOTS.flatMap(({ dir, label }) =>
  readSources(dir, label).flatMap(({ name, text }) => doubleSidedSites(name, text)));

describe('a two-sided material is drawn in one pass', () => {
  it('carries `forceSinglePass` at every `DoubleSide` declaration in the tree', () => {
    expect(
      offenders(SITES),
      'three renders a transparent DoubleSide material TWICE per frame and sets '
      + '`needsUpdate` before each pass (WebGLRenderer :916, :1613), so the '
      + 'program is re-resolved twice per object for an identical picture: add '
      + '`forceSinglePass` where the material is declared',
    ).toEqual([]);
  });

  it('is looking at the sites the review counted', () => {
    // ⚠️ The sweep above is only as good as its reach: a scanner that finds
    // nothing passes. The review counted 14 declarations across eight files;
    // a fifteenth is welcome (it just has to carry the flag), a thirteenth
    // means this file stopped seeing one.
    expect(SITES.length).toBeGreaterThanOrEqual(14);
    expect([...new Set(SITES.map((site) => site.file))].sort()).toEqual([
      'packages/ui/src/components/BlockDeliveryLayer.tsx',
      'packages/ui/src/components/CellGalaxy.tsx',
      'packages/ui/src/components/CellIdentityBindingGlyph.tsx',
      'packages/ui/src/components/CellSemanticOrbit.tsx',
      'packages/ui/src/components/hud/ConsensusMemory.tsx',
      'packages/ui/src/components/hud/InscribedBraidCore.tsx',
      'packages/ui/src/materials/colonyLens.ts',
      'packages/ui/src/materials/contactWaveMaterial.ts',
    ]);
  });

  it('reads declarations rather than prose, and sees a missing flag when there is one', () => {
    // The other half of the reach check: the same scanner over a source that
    // says every one of the four things this file has to tell apart.
    const fixture = [
      'const a = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });',
      'const b = new THREE.ShaderMaterial({ side: THREE.DoubleSide, forceSinglePass: true });',
      'const c = <meshBasicMaterial transparent side={THREE.DoubleSide} />;',
      'const d = <meshBasicMaterial ref={(m) => { hold(m); }} side={THREE.DoubleSide}',
      '  forceSinglePass />;',
      '// side: THREE.DoubleSide, forceSinglePass — prose, not code',
      'const glsl = `side: THREE.DoubleSide { forceSinglePass }`;',
      'const e = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, forceSinglePass: false });',
    ].join('\n');
    const sites = doubleSidedSites('fixture.tsx', fixture);
    expect(sites.map((site) => `${site.line} ${site.owner}`)).toEqual([
      '1 THREE.MeshBasicMaterial({…})',
      '2 THREE.ShaderMaterial({…})',
      '3 <meshBasicMaterial>',
      '4 <meshBasicMaterial>',
      '8 THREE.MeshBasicMaterial({…})',
    ]);
    expect(offenders(sites)).toEqual([
      'fixture.tsx:1 THREE.MeshBasicMaterial({…})',
      'fixture.tsx:3 <meshBasicMaterial>',
      'fixture.tsx:8 THREE.MeshBasicMaterial({…})',
    ]);
  });
});
