// The source-level guards this package runs over every shader, run over the
// program that traces light — plus the three refusals that belong to a RAY
// MARCH and to nothing else here.
//
// ⚠️ IT IS THE ONLY PROGRAM THAT COMPILES THE MIST'S LIBRARY, since 2026-09-03.
// The intake patch was the other one; it went with the composed aperture, and
// with it went `colonyMistShaderGuards.test.ts` — a guard file whose whole
// subject was a material that no longer exists. What that file uniquely carried
// is now here: the LENT column of the snippet ledger (a snippet written in
// `colonyMist.ts` and compiled only in this one) and the claim that every
// snippet the library exports reaches a program, which `colonyMist.test.ts`
// asserts from the other side.
//
// ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES: on this
// project's own AMD/Vulkan driver it once rendered NOTHING AT ALL, and in a
// later lab it produced a driver-dependent funnel mouth. ⚠️ `pow(x, y)` with a
// negative base is undefined too, and undefined QUIETLY.
//
// The three that are this program's own:
//
// ⛔⛔ NO `texture2D`, ANYWHERE, EVER. A sampler inside a march picks its mip
// level from screen-space derivatives, and neighbouring rays end at unrelated
// places: the derivatives explode along one axis and the tile is read from a
// coarse level in stripes. The lab lost a round to it and came back with dashed
// radial noise. Every fetch is `textureLod` with an explicit level — and this
// program is built so that there is no `texture2D` to remove, rather than so
// that a regex removed it.
//
// ⛔ NO STRAIGHT-RAY SHORTCUT. At a handoff radius of ten horizons the
// deflection is still 0.2 rad, and the disc's far edge showed a hard dome cut
// exactly at the seam where the shortcut took over. There is no branch on the
// impact parameter in this program and this file says so.
//
// ⚠️ DECLARATION ORDER. GLSL has no forward declarations by default: a function
// must appear after every helper it calls. The lab's first fibre build rendered
// NOTHING because of it, and the harness swallowed the compile error. Six
// functions go into this program from three files, so the order is checked
// rather than remembered.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// ⭐ The namespaces are what make the coverage claim general: every exported
// STRING in the three material files is a shared GLSL snippet, and the sums
// below find them without being told their names.
import * as colonyCohort from '../../src/materials/colonyCohort';
import * as colonyLens from '../../src/materials/colonyLens';
import * as colonyMist from '../../src/materials/colonyMist';
import {
  COHORT_HOLE_GATE_HI,
  COHORT_HOLE_GATE_LO,
  COHORT_MASS_GLSL_FLOOR,
  makeCohortLensMaterial,
} from '../../src/materials/colonyLens';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/materials/colonyLens.ts'),
  'utf8',
);

/** Strip GLSL/TS comments. Every guard below runs on comment-free text so a
 *  `pow`, a `smoothstep` or the word `texture2D` written in PROSE — and this
 *  program's prose says all three — can never be mistaken for code. */
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
 * A number, where the expression is one — enough for the edges this program
 * writes, which are all uniforms and literals.
 *
 * ⭐ AND THAT IS A PROPERTY OF THE PROGRAM RATHER THAN OF THIS READER. Two
 * `smoothstep`s in the fragment are taken on a radius measured against a LOCAL
 * (the disc's inner edge, the disc's outer edge), and both are written as a
 * FRACTION — `smoothstep(1.0, 1.06, rho / edge)` rather than `smoothstep(edge,
 * edge * 1.06, rho)` — which is the same arithmetic with both edges in plain
 * sight. A future edit that puts the local back in the edge slot lands in
 * `unprovable` below, where it has to be argued.
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

interface Program {
  readonly name: string;
  /** Comment-free, whitespace-squashed: what the guards read. */
  readonly glsl: string;
  /** Comment-free, line structure intact: what the order check reads. */
  readonly text: string;
  readonly uniforms: Map<string, number>;
}

function compile(name: string, material: BuiltProgram): Program[] {
  const uniforms = new Map<string, number>();
  for (const [key, uniform] of Object.entries(material.uniforms)) {
    if (typeof uniform.value === 'number') uniforms.set(key, uniform.value);
  }
  return (['vertexShader', 'fragmentShader'] as const).map((stage) => ({
    name: `${name}.${stage}`,
    glsl: stripComments(material[stage]).replace(/\s+/g, ' '),
    text: stripComments(material[stage]),
    uniforms,
  }));
}

/** The shape of a built material this file reads — three's own, structurally. */
interface BuiltProgram {
  readonly uniforms: Record<string, { value: unknown }>;
  readonly vertexShader: string;
  readonly fragmentShader: string;
}

const LENS = compile('lens', makeCohortLensMaterial());
const LENS_FRAGMENT = LENS.find(({ name }) => name === 'lens.fragmentShader');

/**
 * The GLSL this FILE writes, as opposed to the GLSL it compiles: the text
 * inside every `/* glsl *\/` template literal.
 *
 * ⚠️ IT IS NOT THE WHOLE FILE, AND THAT DIFFERS FROM THE MIST'S GUARD ON
 * PURPOSE. This material ships a TypeScript MIRROR of the fragment's arithmetic
 * — the integrator, the fold, the two disc laws — and the mirror legitimately
 * defines and calls a function named `smoothstep`. Counting the whole file
 * would charge the coverage ledger three TS calls that are not GLSL at all.
 * Slicing at the template literals is exact, and it is safe precisely because
 * the backtick guard below holds: there is no backtick inside the GLSL, so the
 * first one after the marker is the literal's end.
 */
function glslLiterals(source: string): string[] {
  const marker = '/* glsl */ `';
  const literals: string[] = [];
  let at = source.indexOf(marker);
  while (at >= 0) {
    const start = at + marker.length;
    const end = source.indexOf('`', start);
    expect(end).toBeGreaterThan(start);
    literals.push(source.slice(start, end));
    at = source.indexOf(marker, end + 1);
  }
  return literals;
}

describe('colonyLens.ts — source-level shader guards', () => {
  it('has no texture2D anywhere, and every textureLod states its level', () => {
    // ⛔ THE RAY-MARCH LOD TRAP, REFUSED STRUCTURALLY. `mistNoise` is declared
    // by each program that includes the medium, so the lens's fetch is a
    // `textureLod` and there is no `texture2D` in the program to strip.
    for (const program of LENS) {
      expect(`${program.name}: ${program.glsl.includes('texture2D')}`)
        .toBe(`${program.name}: false`);
      // …and no other implicit-derivative fetch either.
      expect(program.glsl).not.toMatch(/\btexture\s*\(/);
      expect(program.glsl).not.toMatch(/\btexture2DProj\b|\btextureCube\b/);
      for (const args of callsOf(program.glsl, 'textureLod')) {
        // sampler, coordinate, LEVEL. A two-argument call does not compile, but
        // a level that is a varying or a derivative would — and would be the
        // same bug with more steps.
        expect(`${program.name}: textureLod arity ${args.length}`)
          .toBe(`${program.name}: textureLod arity 3`);
        expect(args[2].trim()).toBe('uLod');
      }
    }
    // The fetch really is there: three of them, the medium's two and the fibre
    // lane's — all through the one wrapper.
    expect(callsOf(LENS_FRAGMENT?.glsl ?? '', 'textureLod')).toHaveLength(1);
    expect(callsOf(LENS_FRAGMENT?.glsl ?? '', 'mistNoise').length)
      .toBeGreaterThanOrEqual(5);
  });

  it('bends every ray: no branch on the impact parameter', () => {
    // ⛔ THE SHORTCUT THE LAB SHIPPED AND THE PLAN RETIRED. `if (impact >
    // bendR)` traded a hard dome cut at the disc's far edge for steps that the
    // adaptive stretch makes unnecessary anyway: a ray passing at thirty
    // horizons leaves in nine steps.
    const fragment = LENS_FRAGMENT?.glsl ?? '';
    expect(fragment).toContain('float impact = r0 * b;');
    expect(fragment).not.toMatch(/uBendR|bendR/);
    // The impact parameter is read exactly twice — by the adaptive step and by
    // the glow's radius — and never as a condition.
    expect(fragment).not.toMatch(/if\s*\([^)]*\bimpact\b/);
  });

  it('never lets a ray escape while the disc is still outside it', () => {
    // ⚠️⚠️ G5 PHOTOGRAPHED WHAT THE OTHER SPELLING COSTS. The escape test says
    // "the ray has left" — but a ray beyond `1.2 * r0` has NOT left while the
    // disc reaches further than that, and the disc does exactly when the camera
    // stands closer to a mark than `uDiscOut / 1.2` (23.3 wu at the shipped 28
    // wu disc, i.e. every frame past ~66 px/wu). The cut lands wherever the
    // adaptive step happens to sample, so it is not a soft fade: it is a row of
    // hard black wedges bitten out of the disc's far rim, at exactly the camera
    // the film look is for. The radius has to be the larger of the two.
    const fragment = LENS_FRAGMENT?.glsl ?? '';
    const escapes = fragment.match(/if\s*\(phi\s*>[^;]*break;/g) ?? [];
    expect(escapes).toHaveLength(1);
    expect(escapes[0]).toContain('max(r0, discOut)');
    expect(fragment).not.toMatch(/r\s*>\s*r0\s*\*\s*1\.2/);
  });

  it('no smoothstep anywhere has edge0 >= edge1', () => {
    // ⚠️ The fix is always `1.0 - smoothstep(b, a, x)`, never a swap of the
    // third argument.
    const unprovable: string[] = [];
    let checked = 0;
    for (const program of LENS) {
      for (const args of callsOf(program.glsl, 'smoothstep')) {
        const edge0 = evaluate(args[0], program.uniforms);
        const edge1 = evaluate(args[1], program.uniforms);
        if (edge0 === undefined || edge1 === undefined) {
          unprovable.push(`${program.name}: smoothstep(${args[0]},${args[1]}, …)`);
          continue;
        }
        checked += 1;
        const verdict = edge0 < edge1 ? 'ordered' : 'UNDEFINED IN GLSL ES';
        expect(`${program.name}: smoothstep(${edge0}, ${edge1}) is ${verdict}`)
          .toBe(`${program.name}: smoothstep(${edge0}, ${edge1}) is ordered`);
      }
    }
    // ⭐ EMPTY, AND THAT IS A PROPERTY OF THE PROGRAM. Both edges taken against
    // a local are written as fractions of it; see `evaluate` above.
    expect(unprovable).toEqual([]);
    // The fold, the inner band, the outer fade, the inner edge, the fibre lane,
    // the two colour stops, the context exemption — and the HOLE GATE, which is
    // the fold's second, later schedule and the only quantity that has one. The
    // tenth, since 2026-09-06, is the VERTEX stage's copy of the fold (A1-2),
    // which shrinks the quad to the mark on the same closeness the fragment reads.
    expect(checked).toBe(10);
  });

  it('no pow anywhere can be handed a negative base', () => {
    // ⚠️ Five calls: the medium's ridge, the fibres' ridge, the near disc's
    // radial falloff, and the far law TWICE — once where the bent ray finds it
    // and once where the straight one does. Four carry an explicit clamp at
    // zero; the near disc's base is a local that IS one, and this reader
    // resolves it rather than trusting it.
    const guarded = (base: string): boolean =>
      /^max\s*\(.*,\s*0\.0\s*\)$/.test(base) || /^clamp\s*\(.*,\s*0\.0\s*,/.test(base);
    const unproven: string[] = [];
    let checked = 0;
    for (const program of LENS) {
      for (const args of callsOf(program.glsl, 'pow')) {
        checked += 1;
        const base = args[0].trim();
        // A bare name is resolved to its one definition in the same program: a
        // local whose initialiser is itself clamped at zero is as proven as an
        // inline clamp, and is far more readable at the call site.
        const local = /^\w+$/.test(base)
          ? new RegExp(`\\bfloat\\s+${base}\\s*=\\s*([^;]+);`).exec(program.glsl)
          : null;
        const resolved = local === null ? base : local[1].trim();
        if (!guarded(base) && !guarded(resolved)
          && evaluate(resolved, program.uniforms) === undefined) {
          unproven.push(`${program.name}: pow(${base} = ${resolved}, …)`);
        }
      }
    }
    expect(unproven).toEqual([]);
    expect(checked).toBe(5);
    // ⚠️ AND THE ONE THE LAB DID NOT GUARD IS THE FIBRES'. Its `n` carries a
    // `+ (g - 0.5) * 0.18` that can push it outside [0, 1], and `1 - abs(2n -
    // 1)` is then negative. The `max` in `MIST_FIBRES_GLSL` is this port's
    // change to the lab's text, and it is the reason this guard exists.
    expect(colonyMist.MIST_FIBRES_GLSL)
      .toContain('pow(max(1.0 - abs(2.0 * n - 1.0), 0.0), uFibreSharp)');
  });

  it('declares every function before the first call of it', () => {
    // ⚠️ GLSL HAS NO FORWARD DECLARATIONS HERE, and the failure is silent: the
    // program does not link, the draw is dropped, and the layer disappears from
    // a scene that still looks plausible. SIX functions reach this program from
    // THREE files — five from the mist's library, one of its own — so the order
    // is a property of the concatenation and not of any single file.
    for (const program of LENS) {
      const defined = [...program.text.matchAll(
        /^\s*(?:float|int|vec2|vec3|vec4|mat3|mat4|void)\s+(\w+)\s*\(/gm,
      )].map((match) => match[1]);
      for (const name of defined) {
        if (name === 'main') continue;
        const definition = new RegExp(
          `\\b(?:float|int|vec2|vec3|vec4|mat3|mat4|void)\\s+${name}\\s*\\(`,
        ).exec(program.text);
        const firstUse = new RegExp(`\\b${name}\\s*\\(`).exec(program.text);
        // The first time the NAME appears followed by a paren must be its own
        // definition — which is what "declared before every call" means when
        // there are no forward declarations to look for.
        const declaredAt = (definition?.index ?? -1)
          + (definition?.[0].indexOf(name) ?? 0);
        expect(`${program.name}: ${name} first appears at ${firstUse?.index}`)
          .toBe(`${program.name}: ${name} first appears at ${declaredAt}`);
      }
      if (program.name === 'lens.fragmentShader') {
        expect(defined).toEqual([
          'mistNoise', 'mistMedium', 'mistBacktrace', 'mistFibres',
          'mistDiscColor', 'lensDisc', 'lensFarMedium', 'lensFarSample', 'main',
        ]);
      }
    }
  });

  it('declares everything the borrowed snippets reach for', () => {
    // ⭐⭐ THE SNIPPETS ARE FUNCTION TEXT AND NOTHING ELSE — no uniform block, no
    // varying block — because two of them pasted into one program would
    // otherwise collide on a shared declaration. What makes that safe is this:
    // every `uXxx`, `vXxx` and `aXxx` a snippet mentions is declared by EVERY
    // program that includes it, and both programs are checked, not just the new
    // one.
    const shared: [string, string][] = [
      ['MIST_NOISE_LOD_GLSL', colonyMist.MIST_NOISE_LOD_GLSL],
      ['MIST_MEDIUM_GLSL', colonyMist.MIST_MEDIUM_GLSL],
      ['MIST_BACKTRACE_GLSL', colonyMist.MIST_BACKTRACE_GLSL],
      ['MIST_FIBRES_GLSL', colonyMist.MIST_FIBRES_GLSL],
      ['MIST_DISC_COLOR_GLSL', colonyMist.MIST_DISC_COLOR_GLSL],
      ['MIST_SHARE_FACTOR_GLSL', colonyMist.MIST_SHARE_FACTOR_GLSL],
      ['MIST_SEAT_DRIFT_GLSL', colonyMist.MIST_SEAT_DRIFT_GLSL],
      ['COHORT_GULP_GLSL', colonyCohort.COHORT_GULP_GLSL],
      ['COHORT_CONTEXT_ENERGY_GLSL', colonyCohort.COHORT_CONTEXT_ENERGY_GLSL],
    ];
    let pairs = 0;
    for (const program of LENS) {
      for (const [key, snippet] of shared) {
        const body = stripComments(snippet).replace(/\s+/g, ' ');
        if (!program.glsl.includes(body)) continue;
        pairs += 1;
        const names = new Set(
          [...body.matchAll(/\b([uva][A-Z]\w*)\b/g)].map((match) => match[1]),
        );
        for (const name of names) {
          const declared = new RegExp(
            `\\b(?:uniform|varying|attribute)\\s+\\w+\\s+${name}\\s*;`,
          ).test(program.glsl)
            // A varying written by the vertex stage is declared there and read
            // in the fragment; either stage of the same material counts.
            || LENS.some(({ glsl }) => new RegExp(
              `\\b(?:uniform|varying|attribute)\\s+\\w+\\s+${name}\\s*;`,
            ).test(glsl));
          expect(`${program.name} ${key}: ${name} declared ${declared}`)
            .toBe(`${program.name} ${key}: ${name} declared true`);
        }
      }
    }
    // ⚠️ NOT VACUOUS: the loop above really did find the snippets, nine times
    // over — two lanes in the vertex stage, and five library functions plus the
    // gulp and the exemption in the fragment. It was SIXTEEN while the intake
    // patch existed (its own 2 + 5); the patch is retired, so this program is
    // the whole of the ledger's compiled side.
    expect(pairs).toBe(9);
  });

  it('covers every smoothstep and pow the file actually writes', () => {
    // The two guards run over the compiled PROGRAM, so they can resolve
    // uniforms. This is what says the program is the whole of the file's GLSL:
    // a string added to the material and not compiled, or compiled twice, shows
    // up here as a count that no longer matches.
    //
    // ⚠️ THE LEDGER HAS THREE COLUMNS AND THIS FILE OWNS THE MIDDLE ONE. Written
    // here and compiled here: counted once in the literals, so short by
    // `uses - 1`. BORROWED — written in `colonyMist.ts` or `colonyCohort.ts` and
    // compiled here: not in this file's literals at all, so short by the full
    // `uses`. LENT — written here and compiled elsewhere: none today, and
    // `colonyMistShaderGuards.test.ts` carries the mirror image of that case.
    const literals = glslLiterals(SOURCE).map(stripComments);
    // Exactly two: the vertex stage and the fragment stage.
    expect(literals).toHaveLength(2);
    // ⚠️ The cast is what keeps the OWN column general. This file exports no
    // GLSL string today — every snippet it compiles is borrowed — so TypeScript
    // narrows the namespace's value type to one that excludes `string` and the
    // predicate below stops compiling. The day this file lends a snippet out,
    // the ledger already accounts for it.
    const strings = (module: Record<string, unknown>): [string, string][] =>
      (Object.entries(module) as [string, unknown][])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    const own = strings(colonyLens);
    const borrowed = [...strings(colonyMist), ...strings(colonyCohort)];
    for (const name of ['smoothstep', 'pow']) {
      const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const credit = (
        source: readonly [string, string][],
        written: boolean,
      ): number =>
        source.reduce((total, [key, glsl]) => {
          const uses = literals
            .reduce((n, text) => n + [...text.matchAll(
              new RegExp(`\\$\\{${key}\\}`, 'g'),
            )].length, 0);
          const calls = [...stripComments(glsl).matchAll(pattern)].length;
          return total + calls * (written ? uses - 1 : uses);
        }, 0);
      const inFile = literals
        .reduce((total, text) => total + [...text.matchAll(pattern)].length, 0)
        + credit(own, true)
        + credit(borrowed, false);
      const inProgram = LENS
        .reduce((total, program) => total + callsOf(program.glsl, name).length, 0);
      expect(`${name}: ${inProgram} of ${inFile}`).toBe(`${name}: ${inFile} of ${inFile}`);
      expect(inFile).toBeGreaterThan(0);
    }
    // ⭐ AND THE BORROWED CREDIT IS NOT VACUOUS: the snippets really are pasted
    // in, by interpolation and never by hand.
    for (const key of [
      'MIST_NOISE_LOD_GLSL', 'MIST_MEDIUM_GLSL', 'MIST_BACKTRACE_GLSL',
      'MIST_FIBRES_GLSL', 'MIST_DISC_COLOR_GLSL', 'MIST_SHARE_FACTOR_GLSL',
      'MIST_SEAT_DRIFT_GLSL', 'COHORT_GULP_GLSL', 'COHORT_CONTEXT_ENERGY_GLSL',
    ]) {
      expect(`${key}: ${SOURCE.includes('${' + key + '}')}`).toBe(`${key}: true`);
    }
    // …and the medium is not re-typed here under any name.
    expect(stripComments(SOURCE)).not.toContain('float mistMedium(');
    expect(stripComments(SOURCE)).not.toContain('vec2 mistBacktrace(');
  });

  it('is the LENT half of the ledger: the library’s own text, compiled here', () => {
    // ⭐⭐⭐ ONE SUBSTANCE, AND THIS IS WHAT SAYS SO. The disc's texture is not
    // an implementation that agrees with the mist's; it IS the mist's, pasted in
    // by interpolation, so a tuning of the medium lands in the picture the mass
    // computes. That mattered when there were two compilers and it matters more
    // now that there is one: a library with a single consumer is one careless
    // edit away from being inlined and forgotten.
    //
    // ⚠️ THIS IS THE CASE `colonyMistShaderGuards.test.ts` USED TO CARRY. A
    // snippet WRITTEN in `colonyMist.ts` and compiled ONLY here is `n = 0` uses
    // in its own file, so the coverage formula there credited it `-calls`; with
    // the patch retired every snippet the library exports is lent, the file has
    // no program of its own to sweep, and the whole ledger lives on this side.
    // `colonyMist.test.ts` asserts the other direction — that nothing it exports
    // is lent to NOBODY.
    const lensVertex = LENS.find(({ name }) => name === 'lens.vertexShader');
    for (const snippet of [
      colonyMist.MIST_NOISE_LOD_GLSL,
      colonyMist.MIST_MEDIUM_GLSL,
      colonyMist.MIST_BACKTRACE_GLSL,
      colonyMist.MIST_FIBRES_GLSL,
      colonyMist.MIST_DISC_COLOR_GLSL,
    ]) {
      const body = stripComments(snippet).replace(/\s+/g, ' ');
      expect(LENS_FRAGMENT?.glsl).toContain(body);
    }
    for (const snippet of [
      colonyMist.MIST_SHARE_FACTOR_GLSL, colonyMist.MIST_SEAT_DRIFT_GLSL,
    ]) {
      const body = stripComments(snippet).replace(/\s+/g, ' ');
      expect(lensVertex?.glsl).toContain(body);
    }
    // ⚠️ AND THE FETCH IS THE ONE THING THE LIBRARY DOES NOT CONTAIN, which is
    // why it could be lent at all: `mistNoise` is declared by the program, and
    // this program's states its level. The other fetch — `MIST_NOISE_GLSL`, the
    // patch's `texture2D` wrapper — was deleted with the patch, so there is no
    // `texture2D` left anywhere in either file to be pasted in by accident.
    expect(colonyMist).not.toHaveProperty('MIST_NOISE_GLSL');
    expect(stripComments(
      readFileSync(resolve(process.cwd(), 'src/materials/colonyMist.ts'), 'utf8'),
    )).not.toContain('texture2D');
  });

  it('does no marching at the far end, and paints the dark last', () => {
    // ⭐⭐⭐ THE FAR FORM IS NOT A TRACED IMAGE, and both halves of that are TEXT
    // in the program rather than arithmetic anyone can infer from outside it.
    // A traced image at a small mass is a bright ring around a darker centre —
    // a small eye, which the user refused twice — so below the band the
    // fragment reads the intake off the plane along the UNBENT ray and leaves
    // before the loop; and through the band the captured ray's alpha is the
    // hole gate of the closeness, not the closeness, so the dark arrives last.
    const fragment = LENS_FRAGMENT?.glsl ?? '';
    const farReturn = fragment.indexOf('if (closeness <= 0.0) {');
    const loop = fragment.indexOf('for (int i = 0;');
    expect(farReturn).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(farReturn);
    expect(fragment.slice(farReturn, loop)).toContain('return;');
    // The far sample is read along `d`, the unbent ray from the camera, and
    // never along anything the loop produced.
    expect(fragment).toContain('far = lensFarSample(o, d, c, uDiscOutFar * vMass);');
    expect(fragment.indexOf('far = lensFarSample(')).toBeLessThan(farReturn);
    // The straight ray meets the plane by ONE division, no integration.
    expect(fragment).toContain('float t = (c.y - o.y) / d.y;');
    // …and the captured alpha is the gate's two literals, in order.
    expect(fragment).toMatch(new RegExp(
      'acc\\.a = smoothstep\\(\\s*'
      + `${COHORT_HOLE_GATE_LO.toFixed(2)}, ${COHORT_HOLE_GATE_HI.toFixed(2)}, closeness`
      + '\\s*\\);',
    ));
    expect(fragment).not.toContain('acc.a = closeness;');
    // The far form lies UNDER the traced one, weighted by what the trace has
    // not painted, so it is never added on top of the dark.
    expect(fragment).toContain('acc.rgb += far.rgb * (1.0 - over);');
    expect(fragment).toContain('acc.a += far.a * (1.0 - over);');
    // ⭐ The far medium is the library's back-trace and medium, re-read coarse
    // and wound tighter — never a second medium.
    const farMedium = fragment.slice(
      fragment.indexOf('float lensFarMedium('), fragment.indexOf('vec4 lensFarSample('),
    );
    expect(farMedium).toContain('mistBacktrace(local, tau)');
    expect(farMedium).toContain('mistMedium(wound * uFarGrain + vSeat, 0.5)');
    expect(farMedium).toContain('uFarSwirl * log(rr / r)');
    // The log's argument is at least one by construction: rr is floored at r.
    expect(farMedium).toContain('float rr = max(length(p), r);');
  });

  it('lets no length escape the mass: every radius reads the lane', () => {
    // ⭐⭐⭐ ONE VARYING, EVERY LENGTH, AND THIS IS WHAT SAYS SO. The whole form
    // of a cohort is global uniforms, so the mass lane is the only thing that
    // can make two of these marks different pictures — and it only works if
    // NOTHING is left behind. A single world-unit radius still reading its
    // uniform raw would be a small cohort with a full-sized halo, or a
    // full-sized catchment around a small heart: the composed form creeping
    // back in, one constant at a time.
    //
    // ⚠️ EVERYTHING ELSE IS ALREADY IN UNITS OF `rs` OR OF AN EDGE — `uGlowR *
    // rs`, `edge * uGulpR`, `rho / edge`, `rho / outR`, the step's `impact /
    // (2.5 * rs)`, the escape test on `discOut` — so it folds for free. The
    // SUBSTANCE's own grain does not fold and must not: `mistMedium` and
    // `mistBacktrace` are read at the cohort's colony-frame seat in world
    // units, because a parcel of the medium is the same parcel whoever
    // swallows it.
    const fragment = LENS_FRAGMENT?.glsl ?? '';
    const vertex = LENS.find(({ name }) => name === 'lens.vertexShader')?.glsl ?? '';
    // The camera's own scale, first: pixels per SHADOW rather than per world
    // unit, which is what makes every cohort's hole open at the same size.
    expect(fragment).toContain('uPxScale * vMass / r0');
    expect(fragment).not.toMatch(/uPxScale\s*\/\s*r0/);
    // The mass, and with it the inner edge, which is written as a fraction.
    expect(fragment).toContain('uHorizon, closeness) * vMass');
    expect(fragment).toContain('float fold = rs / uHorizon;');
    expect(fragment).toContain('float discIn = uDiscIn * fold;');
    // Both disc radii, the far catchment, the far law's knee and the nucleus.
    expect(fragment).toContain('uDiscOut, closeness) * vMass');
    expect(fragment).toContain('uDiscOutFar * vMass');
    expect(fragment).toContain('uFarGlowR * vMass');
    expect(fragment).toContain('uFarKnee * vMass');
    // ⚠️ AND NOT ONE OF THEM SURVIVES ANYWHERE RAW. The knee is read through a
    // local in BOTH laws — the bent ray's and the straight one's — so the two
    // cannot fold apart, and `uFarKnee` appears only in those two products.
    // Three appearances and no more: the declaration and the two products.
    expect([...fragment.matchAll(/uFarKnee/g)]).toHaveLength(3);
    expect(fragment).not.toContain('uFarKnee / ');
    expect([...fragment.matchAll(/float knee = uFarKnee \* vMass;/g)])
      .toHaveLength(2);
    expect(fragment).not.toContain('uDiscOutFar)');
    expect(fragment).not.toContain('uFarGlowR,');
    // The vertex stage floors the lane and scales the quad — times the mass AND,
    // since 2026-09-06, folded on closeness (A1-2) — so the DOMAIN of the trace
    // shrinks with the picture it computes AND with the camera.
    expect(vertex).toContain('max(abs(aMass),');
    expect(vertex).toContain(
      `vMass = max(abs(aMass), ${COHORT_MASS_GLSL_FLOOR.toFixed(2)});`,
    );
    expect(vertex).toContain('quadR * vMass * 2.0');
    expect(vertex).not.toMatch(/uQuadR \* 2\.0/);
    // ⭐ THE QUAD FOLDS TO THE MARK BELOW THE BAND (A1-2). The half-extent is
    // 1.25× the far disc at closeness 0 and `uQuadR` at closeness 1, on the SAME
    // closeness the fragment reads — recomputed here from the same r0
    // (|camera − origin|), so the two stages cannot fold apart. Same drawn
    // pixels, ~3.3× fewer fragments at the default camera. `cohortLensQuadR`
    // mirrors this line in TypeScript and `colonyLens.test.ts` pins the margin.
    expect(vertex).toContain('float quadR = mix(1.25 * uDiscOutFar, uQuadR, closenessV);');
    expect(vertex).toContain('float r0v = max(length(cameraPosition - origin.xyz), 1e-4);');
    expect(vertex).toContain(
      'float closenessV = smoothstep(uUnfoldLo, uUnfoldHi, uPxScale * vMass / r0v);',
    );
    // …and the fold's uniforms are declared in the vertex stage too, or it will
    // not link — the fragment's own, not a second copy.
    for (const u of ['uPxScale', 'uUnfoldLo', 'uUnfoldHi', 'uDiscOutFar']) {
      expect(vertex).toContain(`uniform float ${u};`);
    }
    // ⭐ THE DEAD FIBRE FETCH IS SKIPPED (A1-3). `mistFibres` — 3 of the 7
    // fetches a disc crossing spends — runs only where its mix weight is
    // positive; `inner` is exactly 0 on ~94% of the disc and `mix(a, b, 0.0)`
    // is `a`, so the guarded output is identical and the unguarded fetch is gone.
    expect(fragment).toContain('float fibW = uFibreMix * inner * closeness;');
    expect(fragment).toContain('if (fibW > 0.0) {');
    expect(fragment).toContain('fib = mix(1.0, mistFibres(rho / edge, th, g, uTime), fibW);');
    expect(fragment).not.toContain(
      'mistFibres(rho / edge, th, g, uTime), uFibreMix * inner * closeness',
    );
    // ⚠️⚠️ THE FLOOR IS A LITERAL THE PROGRAM CANNOT READ AS ZERO, and it is
    // the third of three guards: the layer's array is filled with 1, the motes'
    // geometry allocates its copy at 1, and this is what stands under both.
    expect(COHORT_MASS_GLSL_FLOOR).toBeGreaterThan(0);
    expect(vertex).not.toContain('max(abs(aMass), 0.0)');
    // …and the varying is declared in both stages, or the fragment does not
    // link at all.
    for (const program of LENS) {
      expect(`${program.name}: ${/varying float vMass\s*;/.test(program.glsl)}`)
        .toBe(`${program.name}: true`);
    }
  });

  it('mirrors the whole local frame with the hand, drift included', () => {
    // ⭐⭐⭐ ONE REFLECTION, OR NONE. The hand is the lane's SIGN, and what it
    // buys is that two cohorts the week makes the same size are still two
    // pictures. It only reads as a spiral wound the other way if the WHOLE
    // local frame turns over together: mirror `local.y` and leave the drift
    // alone and the wake swings to the wrong side of a mouth the colony's own
    // rotation decides; mirror one law's frame and not the other's and the
    // fold has a chirality to cross halfway through the band. So the mirror is
    // pinned SITE BY SITE, and the count below is what says there are no
    // others.
    const fragment = LENS_FRAGMENT?.glsl ?? '';
    const vertex = LENS.find(({ name }) => name === 'lens.vertexShader')?.glsl ?? '';
    // The sign, read exactly as `cohortMassUnpack` reads it: `< 0.0` is FALSE
    // for a negative zero in GLSL as it is in TypeScript, so a hand of zero is
    // +1 on both sides.
    expect(vertex).toContain('vHand = aMass < 0.0 ? -1.0 : 1.0;');
    // The drift is reflected with the frame, in the stage that assigns it —
    // after the library's own snippet, which is what leaves it assigned.
    expect([...vertex.matchAll(/vDrift\.y \* vHand/g)]).toHaveLength(1);
    expect(vertex.indexOf('vDrift = vec2(vDrift.x, vDrift.y * vHand);'))
      .toBeGreaterThan(vertex.indexOf('vDrift = tangentLen > 1e-4'));
    // BOTH laws sample the substance in the mirrored frame: the traced disc
    // and the straight far ray, or the two disagree through the cross-fade.
    expect([...fragment.matchAll(/vFrameZ\) \* vHand/g)]).toHaveLength(2);
    // ⚠️ AND NOT ONE UNMIRRORED FRAME SURVIVES.
    expect(fragment).not.toContain('dot(dxz, vFrameZ))');
    // The beaming turns over WITH the spiral: the material's orbital direction
    // is the spiral's, so which side of the disc approaches is a fact about
    // the hand and not about the camera alone.
    expect([...fragment.matchAll(/closeness \* vHand \* dot\(tangent, -view\)/g)])
      .toHaveLength(1);
    // ⭐ Three sites and no fourth. The count includes the DECLARATION — a
    // varying's own line matches too, the trap the `uFarKnee` guard above
    // carries — so the fragment names the hand exactly four times.
    expect([...fragment.matchAll(/vHand/g)]).toHaveLength(4);
    // The vertex stage names it three: the declaration, the sign, the drift.
    expect([...vertex.matchAll(/vHand/g)]).toHaveLength(3);
    // …and it is declared in both stages, or the fragment does not link.
    for (const program of LENS) {
      expect(`${program.name}: ${/varying float vHand\s*;/.test(program.glsl)}`)
        .toBe(`${program.name}: true`);
    }
    // ⛔ THE LIBRARY'S TEXT IS NOT MIRRORED. The mist is one substance read one
    // way; the hand lives in the ARGUMENTS the lens hands it, which is why a
    // left-handed cohort is the same medium and not a second one.
    expect(stripComments(
      readFileSync(resolve(process.cwd(), 'src/materials/colonyMist.ts'), 'utf8'),
    )).not.toContain('vHand');
  });

  it('carries no backtick anywhere in its GLSL', () => {
    // ⚠️ A BACKTICK INSIDE A GLSL COMMENT CLOSES THE TEMPLATE LITERAL — a TS
    // parse error, or an esbuild one, never a shader error, and the message
    // points nowhere near the comment that caused it. It cost this leg a build.
    const material = makeCohortLensMaterial();
    for (const stage of ['vertexShader', 'fragmentShader'] as const) {
      expect(material[stage].includes('`')).toBe(false);
    }
  });
});
