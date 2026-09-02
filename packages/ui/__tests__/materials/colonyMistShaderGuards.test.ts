// The same two source-level guards `cohortShaderGuards.test.ts` runs over the
// mark, run over the mist beside it — plus the two refusals that belong to this
// material alone.
//
// ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES: on this
// project's own AMD/Vulkan driver it once rendered NOTHING AT ALL, and in a
// later lab it produced a driver-dependent funnel mouth. ⚠️ `pow(x, y)` with a
// negative base is undefined too, and undefined QUIETLY — the driver returns
// whatever it returns.
//
// ⭐ IT IS ITS OWN FILE RATHER THAN A ROW IN THE MARK'S, because the coverage
// test at the bottom of each is an EQUALITY against ONE source file: the calls
// in the built programs must account for every call in the file that ships
// them. Two files, two equalities. What travels between them is the shared
// snippets — `COHORT_GULP_GLSL` and `COHORT_CONTEXT_ENERGY_GLSL` are written in
// `colonyCohort.ts` and COMPILED here — and the credit for those is the one
// thing this file computes differently from its neighbour: their text is not in
// this source at all, so every use is surplus, not every use after the first.
//
// The two refusals that are this material's own:
//
// ⭐⭐ NO `uSinks`, NO `uSinkCount`, NO LOOP. The preview's floor was one
// full-plane draw looping over up to eight sinks, which is a hard cap on the
// number of cohorts and a per-fragment loop over all of them. This layer is
// INSTANCED — one patch per cohort, its sink at its own origin — so the cap is
// gone and the arithmetic mentions exactly one mouth. A guard, because the
// obvious "just add a second sink" edit is what puts the cap back.
//
// ⭐⭐ THE RADIUS AND THE LEVEL ARE IMPORTED, NEVER RESTATED. `COHORT_RIM_R` and
// `COHORT_INTAKE_LEVEL` are the mouth's own numbers, and a literal here is the
// bug class that shipped a hole three times too small until 2026-09-02.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// ⭐ The namespaces are what make the coverage claim general: every exported
// STRING in either material file is a shared GLSL snippet, and the sum below
// finds them without being told their names.
import * as colonyCohort from '../../src/materials/colonyCohort';
import * as colonyMist from '../../src/materials/colonyMist';
import {
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../../src/materials/colonyCohort';
import { makeCohortIntakePatchMaterial } from '../../src/materials/colonyMist';

const SOURCE_PATH = resolve(process.cwd(), 'src/materials/colonyMist.ts');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const APERTURE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/materials/colonyCohort.ts'),
  'utf8',
);

/** Strip GLSL/TS comments. Both guards below run on comment-free text so a
 *  `pow` or `smoothstep` written in prose can never be mistaken for code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** The arguments of the call whose `(` is at `open`, split at top level. */
function callArguments(source: string, open: number): string[] {
  let depth = 0;
  let start = open + 1;
  const args: string[] = [];
  for (let i = open; i < source.length; i += 1) {
    const character = source[i];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, i));
        return args;
      }
    } else if (character === ',' && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error('unbalanced parentheses');
}

/** Every call of `name` in `program`, as its argument list. */
function callsOf(program: string, name: string): string[][] {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  return [...program.matchAll(pattern)].map((match) =>
    callArguments(program, (match.index ?? 0) + match[0].length - 1));
}

/**
 * A number, where the expression is one — enough for the edges and bases this
 * material writes, which are all products of uniforms and literals.
 *
 * `undefined` means "this reader does not understand it", and every caller
 * treats that as NOT PROVEN rather than as fine.
 */
function evaluate(
  expression: string,
  uniforms: ReadonlyMap<string, number>,
): number | undefined {
  const tokens = expression.match(/[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z_]\w*|[-+*/()]/g);
  if (tokens === null) return undefined;
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const parseExpr = (): number | undefined => {
    let left = parseTerm();
    while (left !== undefined && (peek() === '+' || peek() === '-')) {
      const operator = tokens[at++];
      const right = parseTerm();
      if (right === undefined) return undefined;
      left = operator === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number | undefined => {
    let left = parseUnary();
    while (left !== undefined && (peek() === '*' || peek() === '/')) {
      const operator = tokens[at++];
      const right = parseUnary();
      if (right === undefined || (operator === '/' && right === 0)) return undefined;
      left = operator === '*' ? left * right : left / right;
    }
    return left;
  };
  const parseUnary = (): number | undefined => {
    if (peek() === '-' || peek() === '+') {
      const operator = tokens[at++];
      const operand = parseUnary();
      return operand === undefined ? undefined : operator === '-' ? -operand : operand;
    }
    const token = peek();
    if (token === undefined) return undefined;
    if (token === '(') {
      at += 1;
      const inner = parseExpr();
      if (inner === undefined || tokens[at++] !== ')') return undefined;
      return inner;
    }
    if (/^[0-9.]/.test(token)) {
      at += 1;
      return Number.parseFloat(token);
    }
    if (/^[A-Za-z_]/.test(token)) {
      at += 1;
      // A call is not a constant this reader can settle.
      if (peek() === '(') return undefined;
      return uniforms.get(token);
    }
    return undefined;
  };
  const value = parseExpr();
  return at === tokens.length ? value : undefined;
}

/** Every GLSL program this file ships, with the uniform values it is drawn
 *  with. Their texts, concatenated, are all the GLSL in the file — which the
 *  coverage test below checks rather than assumes. */
function programs(): { name: string; glsl: string; uniforms: Map<string, number> }[] {
  const built = [
    // ⚠️ EVERY FACTORY IN THE FILE BELONGS HERE. The coverage test below is an
    // EQUALITY between the calls in these programs and the calls in the source,
    // so a factory added to the material file and not to this list fails there.
    ['mistPatch', makeCohortIntakePatchMaterial()],
  ] as const;
  return built.flatMap(([name, material]) => {
    const uniforms = new Map<string, number>();
    for (const [key, uniform] of Object.entries(material.uniforms)) {
      if (typeof uniform.value === 'number') uniforms.set(key, uniform.value);
    }
    return (['vertexShader', 'fragmentShader'] as const).map((stage) => ({
      name: `${name}.${stage}`,
      glsl: stripComments(material[stage]).replace(/\s+/g, ' '),
      uniforms,
    }));
  });
}

describe('colonyMist.ts — source-level shader guards', () => {
  const compiled = programs();

  it('no smoothstep anywhere has edge0 >= edge1', () => {
    // ⚠️ It has bitten this feature twice — once rendering NOTHING on the
    // reference driver, once as a driver-dependent funnel mouth. The fix is
    // always `1.0 - smoothstep(b, a, x)`, never a swap of the third argument.
    const unprovable: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'smoothstep')) {
        const edge0 = evaluate(args[0], program.uniforms);
        const edge1 = evaluate(args[1], program.uniforms);
        if (edge0 === undefined || edge1 === undefined) {
          // Edges built from a varying or a texture cannot be settled here.
          // None exist today, and the empty list below says so; a leg that adds
          // one has to argue it rather than slip it past.
          unprovable.push(`${program.name}: smoothstep(${args[0]},${args[1]}, …)`);
          continue;
        }
        checked += 1;
        const verdict = edge0 < edge1 ? 'ordered' : 'UNDEFINED IN GLSL ES';
        expect(`${program.name}: smoothstep(${edge0}, ${edge1}) is ${verdict}`)
          .toBe(`${program.name}: smoothstep(${edge0}, ${edge1}) is ordered`);
      }
    }
    expect(unprovable).toEqual([]);
    // ⭐ THE INTERESTING ONES ARE THE FRACTIONS OF THE RIM. The gate's edges are
    // `uRimR * uGateIn` and `uRimR * 0.98`, and the wake's are `uRimR * 2.5` and
    // `uWakeLen` — all of them products of live knobs, all of them ordered for
    // every setting the schema allows because `uGateIn` is below 0.98 and the
    // wake is longer than two and a half rim radii. That is why `unprovable` is
    // still empty: an edge built off a varying would have to be argued.
    // ⚠️ The floor was 6 until 2026-09-02: the sixth was the ambient sheets'
    // elliptical fade (`smoothstep(uEdgeIn, uEdgeOut, rho)`), and it left with
    // the sheets after a live leg measured them at 2/255 at their brightest
    // pixel anywhere on the canvas.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('no pow anywhere can be handed a negative base', () => {
    // ⚠️ `pow(x, y)` with `x < 0` is undefined in GLSL. The one call in this
    // layer is the medium's ridge, `1.0 - abs(2.0 * n - 1.0)`, which is in
    // [0, 1] BY CONSTRUCTION and NOT provably so from the source, because `n`
    // comes out of a TEXTURE. It carries an explicit `max(…, 0.0)` for exactly
    // that reason — and this guard is what makes that explicit rather than
    // remembered.
    const unproven: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'pow')) {
        checked += 1;
        const base = args[0].trim();
        // The only base this layer is allowed to write is one whose
        // non-negativity is on its face: a literal clamp at zero.
        if (!/^max\s*\(.*,\s*0\.0\s*\)$/.test(base)
          && !/^clamp\s*\(.*,\s*0\.0\s*,/.test(base)
          && evaluate(base, program.uniforms) === undefined) {
          unproven.push(`${program.name}: pow(${base}, …)`);
        }
      }
    }
    expect(unproven).toEqual([]);
    expect(checked).toBe(1);
  });

  it('covers every smoothstep and pow the file actually contains', () => {
    // The two guards run over the compiled PROGRAMS, so they can resolve
    // uniforms. This is what says the programs are the whole file: a GLSL
    // string added to a material nobody built, or to a third factory, shows up
    // here as a count that no longer matches.
    //
    // ⚠️ TWO KINDS OF SHARED SNIPPET, AND THEY ARE CREDITED DIFFERENTLY. A
    // snippet written HERE and used n times is in the raw file count once, so
    // it is short by `n - 1`. A snippet written in `colonyCohort.ts` and used
    // here is in this file's raw count ZERO times, so it is short by the full
    // `n`. Getting that wrong in either direction turns an EQUALITY into a
    // number that happens to match, which is exactly the check being skipped.
    const file = stripComments(SOURCE);
    const own = Object.entries(colonyMist)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    const borrowed = Object.entries(colonyCohort)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    for (const name of ['smoothstep', 'pow']) {
      const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const surplus = (source: readonly [string, string][], written: boolean): number =>
        source.reduce((total, [key, glsl]) => {
          const uses = [...SOURCE.matchAll(new RegExp(`\\$\\{${key}\\}`, 'g'))].length;
          const calls = [...stripComments(glsl).matchAll(pattern)].length;
          return total + calls * Math.max(written ? uses - 1 : uses, 0);
        }, 0);
      const inFile = [...file.matchAll(pattern)].length
        + surplus(own, true)
        + surplus(borrowed, false);
      const inPrograms = compiled
        .reduce((total, program) => total + callsOf(program.glsl, name).length, 0);
      expect(`${name}: ${inPrograms} of ${inFile}`).toBe(`${name}: ${inFile} of ${inFile}`);
      expect(inFile).toBeGreaterThan(0);
    }
    // ⭐ AND THE BORROWED CREDIT IS NOT VACUOUS: the exemption really is pasted
    // in here and really does carry a `smoothstep` this file never writes.
    expect(SOURCE).toContain('${COHORT_CONTEXT_ENERGY_GLSL}');
    expect(SOURCE).toContain('${COHORT_GULP_GLSL}');
    expect(stripComments(colonyCohort.COHORT_CONTEXT_ENERGY_GLSL))
      .toMatch(/\bsmoothstep\s*\(/);
  });

  it('carries no backtick anywhere in its GLSL', () => {
    // ⚠️ A BACKTICK INSIDE A GLSL COMMENT CLOSES THE TEMPLATE LITERAL — a TS
    // parse error, or an esbuild one, never a shader error, and the message
    // points nowhere near the comment that caused it.
    for (const program of compiled) {
      expect(`${program.name}: ${program.glsl.includes('`')}`)
        .toBe(`${program.name}: false`);
    }
    // The raw sources too, comments and all: the guard above runs on stripped
    // text and the trap lives precisely in what it strips.
    const material = makeCohortIntakePatchMaterial();
    for (const stage of ['vertexShader', 'fragmentShader'] as const) {
      expect(material[stage].includes('`')).toBe(false);
    }
  });

  it('stays cap-free: no sink array, no sink count, no loop over mouths', () => {
    // ⭐⭐ THE PREVIEW'S FLOOR LOOPED OVER `uSinks[8]` BEHIND A `uSinkCount`, and
    // that shape is a hard ceiling on the number of cohorts plus a per-fragment
    // loop over every one of them. This layer is instanced: one patch per
    // cohort, its sink at its OWN ORIGIN, so `COHORT_MARK_CAP` costs it
    // nothing. The obvious edit — "just add a second sink" — is what puts the
    // cap back, so it is refused here rather than in review.
    for (const program of compiled) {
      for (const banned of ['uSinks', 'uSinkCount']) {
        expect(`${program.name}: ${program.glsl.includes(banned)}`)
          .toBe(`${program.name}: false`);
      }
      // No array uniform of any kind, and no loop.
      expect(program.glsl).not.toMatch(/uniform\s+\w+\s+\w+\s*\[/);
      expect(program.glsl).not.toMatch(/\bfor\s*\(/);
    }
    expect(stripComments(SOURCE)).not.toMatch(/\buSinks?Count\b|\buSinks\b/);
  });

  it('declares aShare HERE and in no other program in the feature', () => {
    // ⭐⭐ THE SHARE IS A RATE, AND THIS IS THE ONE PROGRAM WITH A RATE TO SPEND
    // IT ON: the sink's k is wu²/s, so mix(floor, 1, share / shareMax) scales a
    // SPEED and the pile that speed leaves at the lip. The mark above has no
    // such quantity — its only candidate is the grain's drift, which prefilters
    // to nothing past about 25 wu — so `colonyCohort.ts` refuses the lane, and
    // that refusal is checked here rather than remembered.
    const vertex = compiled.find(({ name }) => name === 'mistPatch.vertexShader');
    const fragment = compiled.find(({ name }) => name === 'mistPatch.fragmentShader');
    expect(vertex?.glsl).toContain('attribute float aShare;');
    // Declared AND read: an attribute nothing consumes is a lane the next
    // reader would take as evidence of a consumer that does not exist.
    expect(vertex?.glsl).toContain('aShare / max(uShareMax, 1e-6)');
    // It leaves the vertex stage as ONE varying and is read in the fragment —
    // the sink and the pile — never re-derived there.
    expect(vertex?.glsl).toContain('varying float vShareF;');
    expect(fragment?.glsl).toContain('varying float vShareF;');
    expect(fragment?.glsl).not.toContain('aShare');

    // ⚠️ AND NOWHERE ELSE IN THE FEATURE. The two aperture programs are built
    // and searched, not trusted: the face and the aura must not carry the
    // attribute, the uniforms or the varying.
    for (const [name, material] of [
      ['cohort-face', makeCohortFaceMaterial()],
      ['cohort-aura', makeCohortAuraMaterial()],
    ] as const) {
      for (const stage of ['vertexShader', 'fragmentShader'] as const) {
        const glsl = stripComments(material[stage]);
        for (const banned of ['aShare', 'uShareMax', 'uShareFloor', 'vShareF']) {
          expect(`${name}.${stage}: ${banned} ${glsl.includes(banned)}`)
            .toBe(`${name}.${stage}: ${banned} false`);
        }
      }
    }
    // …and the aperture's own source declares no such attribute either, so a
    // third factory added there cannot quietly pick it up. (Its PROSE says the
    // face refuses the share, which is why the comments are stripped first.)
    expect(stripComments(APERTURE_SOURCE)).not.toMatch(/attribute\s+float\s+aShare/);
  });

  it('reads the mouth’s radius and level from colonyCohort, never as literals', () => {
    // ⚠️⚠️ A DIAMETER READ AS A RADIUS COST THIS FEATURE A ROUND: the shipped
    // hole was three times too small, and both symptoms were measurable. The
    // defence is that there is exactly ONE place either number is written, and
    // it is not this file.
    const imports = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/colonyCohort'/.exec(SOURCE);
    expect(imports).not.toBeNull();
    for (const name of [
      'COHORT_RIM_R', 'COHORT_INTAKE_LEVEL', 'COHORT_GULP_GLSL',
      'COHORT_GULP_INTERIOR', 'COHORT_CONTEXT_ENERGY_GLSL', 'COHORT_INTERIOR_COLD',
    ]) {
      expect(imports?.[1]).toContain(name);
    }
    // Bound from the import, and nowhere restated as a number.
    expect(stripComments(SOURCE)).toContain('uRimR: { value: COHORT_RIM_R }');
    expect(stripComments(SOURCE)).toContain('uLevel: { value: COHORT_INTAKE_LEVEL }');
    expect(stripComments(SOURCE))
      .not.toMatch(/\b(uRimR|uLevel)\s*:\s*\{\s*value:\s*[0-9]/);
    // ⭐ And the values really are the mouth's, so the import is not decorative.
    expect(colonyMist.MIST_COLOR).toBe(colonyCohort.COHORT_INTERIOR_COLD);
    const patch = makeCohortIntakePatchMaterial();
    expect(patch.uniforms.uRimR.value).toBe(colonyCohort.COHORT_RIM_R);
    expect(patch.uniforms.uLevel.value).toBe(colonyCohort.COHORT_INTAKE_LEVEL);
  });
});
