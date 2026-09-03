// The source-level guards `cohortShaderGuards.test.ts`, `colonyMistShaderGuards`
// and `colonyLensShaderGuards` run over the mark, the mist and the trace, run
// over the program that draws the specks — plus the two refusals that belong to
// a POINTS program and to nothing else in this package.
//
// ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES: on this
// project's own AMD/Vulkan driver it once rendered NOTHING AT ALL. ⚠️ `pow(x, y)`
// with a negative base is undefined too, and undefined QUIETLY.
//
// The two that are this program's own:
//
// ⛔ NO SAMPLER AT ALL. Every other program in this feature reads the mist's
// noise tile; this one draws points whose entire fragment input is one float, so
// a texture here would be a texture nobody could see at a pixel and a half. The
// absence is asserted rather than assumed, because a fetch added later would be
// a per-mote cost in a draw that is meant to be free.
//
// ⛔ NOTHING MAY LIFT A MOTE OFF THE MEMBRANE. The user's fourth rule is
// structural in this program — the offset's Y is a literal zero — and this file
// is where that stays true.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// ⭐ The namespaces are what make the coverage claim general: every exported
// STRING in the material files is a shared GLSL snippet, and the sums below find
// them without being told their names.
import * as colonyCohort from '../../src/materials/colonyCohort';
import * as colonyLens from '../../src/materials/colonyLens';
import * as colonyMist from '../../src/materials/colonyMist';
import * as colonyMotes from '../../src/materials/colonyMotes';
import { makeCohortMotesMaterial } from '../../src/materials/colonyMotes';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/materials/colonyMotes.ts'),
  'utf8',
);

/** Strip GLSL/TS comments, so a `pow` or a `smoothstep` written in PROSE — and
 *  this program's prose says both — can never be read as code. */
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
 */
function evaluate(
  expression: string,
  uniforms: ReadonlyMap<string, number>,
): number | undefined {
  const tokens = expression
    .match(/[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z_]\w*|[-+*/()]/g);
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

/** The shape of a built material this file reads — three's own, structurally. */
interface BuiltProgram {
  readonly uniforms: Record<string, { value: unknown }>;
  readonly vertexShader: string;
  readonly fragmentShader: string;
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

const MOTES = compile('motes', makeCohortMotesMaterial());
const MOTES_VERTEX = MOTES.find(({ name }) => name === 'motes.vertexShader');
const MOTES_FRAGMENT = MOTES.find(({ name }) => name === 'motes.fragmentShader');

/**
 * The GLSL this FILE writes, as opposed to the GLSL it compiles: the text inside
 * every `/* glsl *\/` template literal. It is not the whole file, because the
 * module ships a TypeScript MIRROR that legitimately defines and calls a
 * function named `smoothstep`. Slicing at the literals is exact, and it is safe
 * precisely because the backtick guard below holds.
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

describe('colonyMotes.ts — source-level shader guards', () => {
  it('reads no texture at all, in either stage', () => {
    // ⛔ A SAMPLER HERE WOULD BE A TEXTURE NOBODY COULD SEE. A mote is a pixel
    // and a half at the far end of the fold and half a world unit at the near
    // one; its whole fragment input is one float. The mist's medium belongs to
    // the surfaces that are big enough to show it.
    for (const program of MOTES) {
      expect(`${program.name}: ${program.glsl.includes('texture')}`)
        .toBe(`${program.name}: false`);
      expect(program.glsl).not.toMatch(/\bsampler2D\b|\bsamplerCube\b/);
    }
  });

  it('keeps every mote in the membrane, structurally', () => {
    // ⛔⛔ THE USER'S FOURTH RULE. A cohort never emits toward the canopy, and in
    // this program that is not a clamp or a branch: the offset from the seat is
    // built with a LITERAL ZERO in Y, so no uniform, knob or seed can move a mote
    // out of the colony's plane.
    const vertex = MOTES_VERTEX?.glsl ?? '';
    expect(vertex)
      .toContain('vec3 local = aOrigin + vec3(cos(theta) * r, 0.0, sin(theta) * r);');
    // …and that is the ONLY place a position is built, so there is no second
    // path that could carry a height: one vec3 constructor in the whole stage.
    expect(callsOf(vertex, 'vec3')).toHaveLength(1);
    expect(vertex).not.toMatch(/\blocal\.y\b|\bworld\.y\b|\bseat\.y\s*[+-]/);
  });

  it('no smoothstep anywhere has edge0 >= edge1', () => {
    // ⚠️ The fix is always `1.0 - smoothstep(b, a, x)`, never a swap of the third
    // argument.
    const unprovable: string[] = [];
    let checked = 0;
    for (const program of MOTES) {
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
    // ⭐ EMPTY, AND THAT IS A PROPERTY OF THE PROGRAM: both edges of both calls
    // are a uniform or a literal, never a local.
    expect(unprovable).toEqual([]);
    // The fold's band and the fade-in.
    expect(checked).toBe(2);
  });

  it('no pow can be handed a negative base, and the vertex writes none at all', () => {
    // ⭐ THE VERTEX STAGE HAS NO `pow`, AND THAT IS DELIBERATE. The orbital swing
    // needs r^1.5 on a radius the compiler cannot prove positive at the call
    // site; it is written as `rq * sqrt(rq)` on a floored radius instead, which
    // is the same arithmetic with nothing left to prove.
    expect(callsOf(MOTES_VERTEX?.glsl ?? '', 'pow')).toHaveLength(0);
    expect(MOTES_VERTEX?.glsl).toContain('rq * sqrt(rq)');
    expect(MOTES_VERTEX?.glsl).toMatch(/float rq = max\(r, [0-9.]+\);/);

    // ⚠️ AND THE FRAGMENT'S TWO ARE PROVEN BY THE DISCARD ABOVE THEM, which is
    // the peer sprite's own idiom: past the unit radius there is no fragment at
    // all, so `1.0 - r` is in [0, 1] wherever a power is evaluated.
    const fragment = MOTES_FRAGMENT?.glsl ?? '';
    const powers = callsOf(fragment, 'pow');
    expect(powers).toHaveLength(2);
    for (const args of powers) expect(args[0].trim()).toBe('1.0 - r');
    const guard = fragment.indexOf('if (r > 1.0) discard;');
    expect(guard).toBeGreaterThan(0);
    expect(fragment.indexOf('pow(')).toBeGreaterThan(guard);
    // The radius really is the point's own coordinate and not something a
    // uniform could push past 1 before the guard runs.
    expect(fragment).toContain('float r = length(gl_PointCoord - 0.5) * 2.0;');
  });

  it('declares every function before the first call of it', () => {
    // ⚠️ GLSL HAS NO FORWARD DECLARATIONS HERE, and the failure is silent: the
    // program does not link, the draw is dropped, and the layer disappears from a
    // scene that still looks plausible.
    for (const program of MOTES) {
      const defined = [...program.text.matchAll(
        /^\s*(?:float|int|vec2|vec3|vec4|mat3|mat4|void)\s+(\w+)\s*\(/gm,
      )].map((match) => match[1]);
      for (const name of defined) {
        if (name === 'main') continue;
        const definition = new RegExp(
          `\\b(?:float|int|vec2|vec3|vec4|mat3|mat4|void)\\s+${name}\\s*\\(`,
        ).exec(program.text);
        const firstUse = new RegExp(`\\b${name}\\s*\\(`).exec(program.text);
        const declaredAt = (definition?.index ?? -1)
          + (definition?.[0].indexOf(name) ?? 0);
        expect(`${program.name}: ${name} first appears at ${firstUse?.index}`)
          .toBe(`${program.name}: ${name} first appears at ${declaredAt}`);
      }
      if (program.name === 'motes.vertexShader') {
        expect(defined).toEqual(['moteHash', 'main']);
      }
      if (program.name === 'motes.fragmentShader') expect(defined).toEqual(['main']);
    }
  });

  it('declares everything the borrowed envelope reaches for', () => {
    // ⭐⭐ THE SNIPPET IS STATEMENT TEXT AND NOTHING ELSE — no uniform block, no
    // varying block — so every `uXxx`, `vXxx` and `aXxx` it mentions has to be in
    // scope where it is pasted.
    //
    // ⚠️ AND ONE OF THEM IS A LOCAL HERE, WHICH IS THIS PROGRAM'S OWN CASE.
    // `COHORT_GULP_GLSL` names its input `vGulp` because every other program that
    // compiles it consumes the gulp in the FRAGMENT, where the lane has to arrive
    // as a varying. This one spends it in the VERTEX stage, where the lane is an
    // attribute already in scope — so the name is bound to a local instead of
    // being carried across the interpolator for nothing.
    const vertex = MOTES_VERTEX?.glsl ?? '';
    const body = stripComments(colonyCohort.COHORT_GULP_GLSL).replace(/\s+/g, ' ');
    expect(vertex).toContain(body);
    expect(vertex).toContain('float vGulp = aGulp;');
    expect(vertex.indexOf('float vGulp = aGulp;')).toBeLessThan(vertex.indexOf(body));
    for (const name of [...body.matchAll(/\b([uva][A-Z]\w*)\b/g)].map((m) => m[1])) {
      const declared = new RegExp(
        `\\b(?:uniform|varying|attribute)\\s+\\w+\\s+${name}\\s*;`,
      ).test(vertex)
        || new RegExp(`\\bfloat\\s+${name}\\s*=`).test(vertex);
      expect(`${name} in scope: ${declared}`).toBe(`${name} in scope: true`);
    }
    // The `gulp` the envelope leaves behind is spent exactly once, on the burst:
    // its own declaration, and the read.
    expect([...vertex.matchAll(/\bgulp\b/g)]).toHaveLength(2);
  });

  it('covers every smoothstep and pow the file actually writes', () => {
    // The two guards run over the compiled PROGRAM, so they can resolve
    // uniforms. This is what says the program is the whole of the file's GLSL: a
    // string added to the material and not compiled, or compiled twice, shows up
    // here as a count that no longer matches.
    //
    // ⚠️ THE LEDGER'S THREE COLUMNS, as `colonyLensShaderGuards.test.ts` states
    // them. OWN: written here and compiled here, so short by `uses - 1`.
    // BORROWED: written elsewhere and compiled here, short by the full `uses`.
    // LENT: written here and compiled elsewhere — none today.
    const literals = glslLiterals(SOURCE).map(stripComments);
    expect(literals).toHaveLength(2);
    const strings = (module: Record<string, unknown>): [string, string][] =>
      (Object.entries(module) as [string, unknown][])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    const own = strings(colonyMotes);
    const borrowed = [
      ...strings(colonyMist), ...strings(colonyCohort), ...strings(colonyLens),
    ];
    for (const name of ['smoothstep', 'pow']) {
      const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const credit = (
        source: readonly [string, string][],
        written: boolean,
      ): number =>
        source.reduce((total, [key, glsl]) => {
          const uses = literals.reduce((n, text) => n + [...text.matchAll(
            new RegExp(`\\$\\{${key}\\}`, 'g'),
          )].length, 0);
          const calls = [...stripComments(glsl).matchAll(pattern)].length;
          return total + calls * (written ? uses - 1 : uses);
        }, 0);
      const inFile = literals
        .reduce((total, text) => total + [...text.matchAll(pattern)].length, 0)
        + credit(own, true)
        + credit(borrowed, false);
      const inProgram = MOTES
        .reduce((total, program) => total + callsOf(program.glsl, name).length, 0);
      expect(`${name}: ${inProgram} of ${inFile}`).toBe(`${name}: ${inFile} of ${inFile}`);
      expect(inFile).toBeGreaterThan(0);
    }
    // ⭐ AND THE BORROWED CREDIT IS NOT VACUOUS: the envelope really is pasted in,
    // by interpolation and never by hand.
    expect(SOURCE).toContain('${COHORT_GULP_GLSL}');
    expect(stripComments(SOURCE)).not.toContain('float gulpAge =');
  });

  it('interpolates its constants rather than repeating them as literals', () => {
    // ⭐ EVERY NUMBER IN THE PROGRAM IS A UNIFORM OR AN INTERPOLATED CONSTANT, so
    // a value moved in the header moves in the shader and the mirror at once.
    // What is left as a bare literal is arithmetic that has no name: the unit
    // interval's ends, a turn in radians, and the epsilons.
    const vertex = MOTES_VERTEX?.glsl ?? '';
    for (const [name, value] of [
      ['the sink floor', colonyMotes.COHORT_MOTE_K_FLOOR],
      ['the birth floor', colonyMotes.COHORT_MOTE_R0_FLOOR],
      ['the vanish', colonyMotes.COHORT_MOTE_VANISH],
      ['the fade-in', colonyMotes.COHORT_MOTE_FADE_IN],
      ['the brightness floor', colonyMotes.COHORT_MOTE_FLOOR],
      ['the burst', colonyMotes.COHORT_MOTE_GULP_BURST],
      ['the far dim', colonyMotes.COHORT_MOTE_FAR_DIM],
      ['the size floor', colonyMotes.COHORT_MOTE_SIZE_FLOOR],
      ['the size ramp', colonyMotes.COHORT_MOTE_SIZE_GROW],
      ['the pixel floor', colonyMotes.COHORT_MOTE_PIXEL_FLOOR],
      ['the swing floor', colonyMotes.COHORT_MOTE_ORBIT_R_FLOOR],
    ] as const) {
      expect(`${name}: ${vertex.includes(String(value))}`).toBe(`${name}: true`);
    }
    // The three hash salts, which are the only reason 96 motes are 96 motes.
    for (const salt of Object.values(colonyMotes.COHORT_MOTE_HASH)) {
      expect(`salt ${salt}: ${vertex.includes(String(salt))}`)
        .toBe(`salt ${salt}: true`);
    }
    // ⚠️ AND EVERY INTERPOLATED NUMBER IS A GLSL FLOAT. An integer constant
    // written without its point is an INT in GLSL ES, and `max(int, float)` does
    // not compile — a whole class of failure that only the driver would report,
    // and one a `.toFixed()` left off a constant walks straight into.
    let arguments_ = 0;
    for (const program of MOTES) {
      for (const call of ['max', 'min', 'mix', 'step', 'smoothstep']) {
        for (const args of callsOf(program.glsl, call)) {
          for (const argument of args) {
            arguments_ += 1;
            expect(`${call} takes: ${argument.trim()}`).not.toMatch(/: -?\d+$/);
          }
        }
      }
    }
    // Not vacuous: there really are that many float arguments to check.
    expect(arguments_).toBeGreaterThan(20);
  });

  it('carries no backtick anywhere in its GLSL', () => {
    // ⚠️ A BACKTICK INSIDE A GLSL COMMENT CLOSES THE TEMPLATE LITERAL — a TS parse
    // error, or an esbuild one, never a shader error, and the message points
    // nowhere near the comment that caused it.
    const material = makeCohortMotesMaterial();
    for (const stage of ['vertexShader', 'fragmentShader'] as const) {
      expect(material[stage].includes('`')).toBe(false);
    }
  });
});
