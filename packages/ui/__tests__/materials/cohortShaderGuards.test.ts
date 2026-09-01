// Two source-level guards over the WHOLE of `materials/colonyCohort.ts` — each
// paid for with a real bug, and neither one about a program in particular.
//
// ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES: on this
// project's own AMD/Vulkan driver it once rendered NOTHING AT ALL, and in a
// later lab it produced a driver-dependent funnel mouth. ⚠️ `pow(x, y)` with a
// negative base is undefined too, and undefined QUIETLY — the driver returns
// whatever it returns.
//
// ⭐ THEY LIVE IN THEIR OWN FILE BECAUSE THEY OUTLIVE EVERY PROGRAM. They were
// written for the accreting void, inherited by the marched vertical throat, and
// now sweep the aperture; twice they travelled as a passenger inside a test
// file whose SUBJECT was being deleted, and the second time that deletion would
// have taken them with it. Nothing here names a form: the guards run over every
// factory the material file exports, and the coverage test is an EQUALITY, so a
// program added to the file and not to the list below fails HERE rather than
// passing quietly wherever it was added.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// ⭐ The namespace is what makes the coverage claim general: every exported
// STRING in the material file is a shared GLSL snippet, and the coverage sum
// finds them without being told their names.
import * as colonyCohort from '../../src/materials/colonyCohort';
import {
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../../src/materials/colonyCohort';

const SOURCE_PATH = resolve(process.cwd(), 'src/materials/colonyCohort.ts');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

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

/* --- a tiny expression reader, enough for the two guards ------------------ */

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; operator: string; operand: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node };

function tokenise(expression: string): string[] {
  return expression.match(/[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z_][\w.]*|[-+*/(),]/g)
    ?? [];
}

/** `undefined` where the grammar runs out — every caller treats that as "not
 *  proven", never as "fine". */
function parseExpression(expression: string): Node | undefined {
  const tokens = tokenise(expression);
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string => tokens[at++];
  const parseExpr = (): Node | undefined => {
    let left = parseTerm();
    while (left !== undefined && (peek() === '+' || peek() === '-')) {
      const operator = take();
      const right = parseTerm();
      if (right === undefined) return undefined;
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  };
  const parseTerm = (): Node | undefined => {
    let left = parseUnary();
    while (left !== undefined && (peek() === '*' || peek() === '/')) {
      const operator = take();
      const right = parseUnary();
      if (right === undefined) return undefined;
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  };
  const parseUnary = (): Node | undefined => {
    if (peek() === '-' || peek() === '+') {
      const operator = take();
      const operand = parseUnary();
      return operand === undefined ? undefined : { kind: 'unary', operator, operand };
    }
    return parsePrimary();
  };
  const parsePrimary = (): Node | undefined => {
    const token = peek();
    if (token === undefined) return undefined;
    if (token === '(') {
      take();
      const inner = parseExpr();
      if (inner === undefined || take() !== ')') return undefined;
      return inner;
    }
    if (/^[0-9.]/.test(token)) {
      take();
      return { kind: 'number', value: Number.parseFloat(token) };
    }
    if (/^[A-Za-z_]/.test(token)) {
      take();
      if (peek() !== '(') return { kind: 'name', name: token };
      take();
      const args: Node[] = [];
      if (peek() === ')') take();
      else {
        for (;;) {
          const argument = parseExpr();
          if (argument === undefined) return undefined;
          args.push(argument);
          const next = take();
          if (next === ')') break;
          if (next !== ',') return undefined;
        }
      }
      return { kind: 'call', name: token, args };
    }
    return undefined;
  };
  const parsed = parseExpr();
  return at === tokens.length ? parsed : undefined;
}

/** What a name in one program can be resolved to: a bound uniform value, or a
 *  local `float` declared exactly once (a name assigned again is dropped —
 *  its declaration is no longer the whole story). */
interface Scope {
  readonly uniforms: ReadonlyMap<string, number>;
  readonly locals: ReadonlyMap<string, string>;
}

function scopeOf(program: string, uniforms: ReadonlyMap<string, number>): Scope {
  const body = stripComments(program).replace(/\s+/g, ' ');
  const locals = new Map<string, string>();
  for (const match of body.matchAll(/\bfloat\s+(\w+)\s*=\s*([^;]+);/g)) {
    const [, name, expression] = match;
    const assignments = [...body.matchAll(new RegExp(`\\b${name}\\s*=(?!=)`, 'g'))];
    if (assignments.length !== 1) continue;
    locals.set(name, expression);
  }
  return { uniforms, locals };
}

function resolveLocal(name: string, scope: Scope): Node | undefined {
  const local = scope.locals.get(name);
  return local === undefined ? undefined : parseExpression(local);
}

/** A number, where the expression is one. */
function evaluate(node: Node, scope: Scope, seen: ReadonlySet<string>): number | undefined {
  if (node.kind === 'number') return node.value;
  if (node.kind === 'name') {
    const bound = scope.uniforms.get(node.name);
    if (bound !== undefined) return bound;
    if (seen.has(node.name)) return undefined;
    const local = resolveLocal(node.name, scope);
    return local === undefined
      ? undefined
      : evaluate(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'unary') {
    const operand = evaluate(node.operand, scope, seen);
    if (operand === undefined) return undefined;
    return node.operator === '-' ? -operand : operand;
  }
  if (node.kind === 'binary') {
    const left = evaluate(node.left, scope, seen);
    const right = evaluate(node.right, scope, seen);
    if (left === undefined || right === undefined) return undefined;
    if (node.operator === '+') return left + right;
    if (node.operator === '-') return left - right;
    if (node.operator === '*') return left * right;
    return right === 0 ? undefined : left / right;
  }
  const args = node.args.map((argument) => evaluate(argument, scope, seen));
  if (args.some((value) => value === undefined)) return undefined;
  const numbers = args as number[];
  if (node.name === 'max') return Math.max(...numbers);
  if (node.name === 'min') return Math.min(...numbers);
  if (node.name === 'abs') return Math.abs(numbers[0]);
  if (node.name === 'sqrt') return Math.sqrt(numbers[0]);
  if (node.name === 'exp') return Math.exp(numbers[0]);
  if (node.name === 'pow') return Math.pow(numbers[0], numbers[1]);
  if (node.name === 'clamp') return clamp(numbers[0], numbers[1], numbers[2]);
  return undefined;
}

/** An upper bound on |node|, where one is obvious — enough for `A + B*cos(x)`. */
function magnitudeBound(node: Node, scope: Scope, seen: ReadonlySet<string>): number | undefined {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return Math.abs(exact);
  if (node.kind === 'call' && (node.name === 'cos' || node.name === 'sin')) return 1;
  if (node.kind === 'unary') return magnitudeBound(node.operand, scope, seen);
  if (node.kind === 'binary' && node.operator === '*') {
    const left = magnitudeBound(node.left, scope, seen);
    const right = magnitudeBound(node.right, scope, seen);
    return left === undefined || right === undefined ? undefined : left * right;
  }
  if (inUnitInterval(node, scope, seen)) return 1;
  return undefined;
}

/** Provably within [0, 1]. */
function inUnitInterval(node: Node, scope: Scope, seen: ReadonlySet<string>): boolean {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return exact >= 0 && exact <= 1;
  if (node.kind === 'name') {
    if (seen.has(node.name)) return false;
    const local = resolveLocal(node.name, scope);
    return local !== undefined
      && inUnitInterval(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'call') {
    if (node.name === 'smoothstep' || node.name === 'fract') return true;
    if (node.name === 'clamp' && node.args.length === 3) {
      const low = evaluate(node.args[1], scope, seen);
      const high = evaluate(node.args[2], scope, seen);
      return low !== undefined && high !== undefined && low >= 0 && high <= 1;
    }
    return false;
  }
  if (node.kind === 'binary') {
    if (node.operator === '*') {
      return inUnitInterval(node.left, scope, seen)
        && inUnitInterval(node.right, scope, seen);
    }
    if (node.operator === '-') {
      const left = evaluate(node.left, scope, seen);
      return left === 1 && inUnitInterval(node.right, scope, seen);
    }
  }
  return false;
}

/**
 * Provably ≥ 0.
 *
 * ⚠️ `pow(x, y)` with a negative `x` is UNDEFINED in GLSL, and it is undefined
 * quietly: the driver returns whatever it returns. Anything this returns
 * `false` for is not necessarily a bug — it is a base nobody has proven safe,
 * which is exactly the thing that should have to be argued in review.
 */
function nonNegative(node: Node, scope: Scope, seen: ReadonlySet<string>): boolean {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return exact >= 0;
  if (inUnitInterval(node, scope, seen)) return true;
  if (node.kind === 'name') {
    if (seen.has(node.name)) return false;
    const local = resolveLocal(node.name, scope);
    return local !== undefined
      && nonNegative(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'call') {
    // Ranges GLSL itself guarantees.
    if (['abs', 'length', 'exp', 'sqrt', 'fract', 'smoothstep', 'pow', 'dot']
      .includes(node.name)) {
      // `dot(a, b)` only when it is a squared length.
      if (node.name !== 'dot') return true;
      return node.args.length === 2
        && JSON.stringify(node.args[0]) === JSON.stringify(node.args[1]);
    }
    if (node.name === 'max') {
      return node.args.some((argument) => nonNegative(argument, scope, seen));
    }
    if (node.name === 'min') {
      return node.args.every((argument) => nonNegative(argument, scope, seen));
    }
    if (node.name === 'clamp' && node.args.length === 3) {
      return nonNegative(node.args[1], scope, seen);
    }
    if (node.name === 'mix' && node.args.length === 3) {
      return nonNegative(node.args[0], scope, seen)
        && nonNegative(node.args[1], scope, seen)
        && inUnitInterval(node.args[2], scope, seen);
    }
    return false;
  }
  if (node.kind === 'binary') {
    if (node.operator === '*' || node.operator === '/') {
      return nonNegative(node.left, scope, seen) && nonNegative(node.right, scope, seen);
    }
    // `A ± B` where A is a number that dominates every value B can take —
    // `0.5 + 0.5 * cos(x)` and `1.0 - smoothstep(a, b, x)` are both this.
    const anchor = evaluate(node.left, scope, seen);
    const swing = magnitudeBound(node.right, scope, seen);
    if (anchor !== undefined && swing !== undefined && anchor >= swing) return true;
    if (node.operator === '+') {
      return nonNegative(node.left, scope, seen) && nonNegative(node.right, scope, seen);
    }
  }
  return false;
}

/** Every GLSL program this file ships, with the uniform values it is drawn
 *  with. Their texts, concatenated, are all the GLSL in the file — which the
 *  coverage test below checks rather than assumes. */
function programs(): { name: string; glsl: string; scope: Scope }[] {
  const built = [
    // ⚠️ EVERY FACTORY IN THE FILE BELONGS HERE. The coverage test below is an
    // EQUALITY between the calls in these programs and the calls in the source,
    // so a factory added to the material file and not to this list fails there
    // — which is the point of the equality.
    ['cohortFace', makeCohortFaceMaterial()],
    ['cohortAura', makeCohortAuraMaterial()],
  ] as const;
  return built.flatMap(([name, material]) => {
    const uniforms = new Map<string, number>();
    for (const [key, uniform] of Object.entries(material.uniforms)) {
      if (typeof uniform.value === 'number') uniforms.set(key, uniform.value);
    }
    return (['vertexShader', 'fragmentShader'] as const).map((stage) => {
      const glsl = stripComments(material[stage]).replace(/\s+/g, ' ');
      return { name: `${name}.${stage}`, glsl, scope: scopeOf(glsl, uniforms) };
    });
  });
}

describe('colonyCohort.ts — source-level shader guards', () => {
  const compiled = programs();

  it('no smoothstep anywhere has edge0 >= edge1', () => {
    // ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES. It is
    // not a warning and not a fallback: on this project's own AMD/Vulkan
    // driver it once rendered NOTHING AT ALL, and in the R17 lab it produced a
    // driver-dependent funnel mouth. The fix is always `1.0 - smoothstep(b, a,
    // x)`, never a swap of the third argument. It has bitten twice; this is
    // what stops a third.
    const unprovable: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'smoothstep')) {
        const edges = args.slice(0, 2).map((argument) => {
          const node = parseExpression(argument);
          return node === undefined
            ? undefined
            : evaluate(node, program.scope, new Set());
        });
        const [edge0, edge1] = edges;
        if (edge0 === undefined || edge1 === undefined) {
          // Edges built from a varying or a texture cannot be settled here.
          // None exist today, and the coverage claim below says so; a leg
          // that adds one has to argue it rather than slip it past.
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
    // ⚠️ THE FLOOR HAS MOVED THREE TIMES AND IS NOT THE CLAIM. It came down
    // from 10 when the accreting void's two programs went, back up by two when
    // the proximity exemption put one `smoothstep` in each surviving program,
    // and down again when the marched throat's two went — the file has held
    // two, four and two programs, and a floor tracking that says nothing. It is
    // only a says-the-parser-ran check: what makes the sweep COMPLETE is the
    // coverage test below, which pins these against every call in the file.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('no pow anywhere can be handed a negative base', () => {
    // ⚠️ `pow(x, y)` with `x < 0` is undefined in GLSL. Use `d * d` for a
    // square, `max(x, 0.0)` where the sign is merely awkward, and a clamp
    // where it is genuinely unknown.
    const unproven: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'pow')) {
        const node = parseExpression(args[0]);
        checked += 1;
        if (node === undefined || !nonNegative(node, program.scope, new Set())) {
          unproven.push(`${program.name}: pow(${args[0].trim()}, …)`);
        }
      }
    }
    expect(unproven).toEqual([]);
    // Same story, and the aperture is far thinner than what it replaced: two
    // `pow` calls survive, one in each program. The completeness claim is the
    // coverage test below, not this.
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('covers every smoothstep and pow the file actually contains', () => {
    // The two guards run over the compiled PROGRAMS, so they can resolve
    // uniforms and locals. This is what says the programs are the whole file:
    // a GLSL string added to a material nobody built, or to a third factory,
    // shows up here as a count that no longer matches.
    // ⚠️ A SHARED SNIPPET IS WRITTEN ONCE AND COMPILED ONCE PER USE SITE.
    // `COHORT_CONTEXT_ENERGY_GLSL` holds one `smoothstep` and is pasted into
    // both programs, so a raw file count is short by exactly one call per
    // EXTRA use. Adding that surplus back keeps this an EQUALITY rather than
    // weakening it to "at least", which would let a whole unbuilt program slip
    // through. The surplus is clamped at zero on purpose: a snippet that is
    // never interpolated then still fails here, which is the right verdict for
    // GLSL nobody compiles.
    const file = stripComments(SOURCE);
    const shared = Object.entries(colonyCohort)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    for (const name of ['smoothstep', 'pow']) {
      const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const surplus = shared.reduce((total, [key, glsl]) => {
        const uses = [...SOURCE.matchAll(new RegExp(`\\$\\{${key}\\}`, 'g'))].length;
        const calls = [...stripComments(glsl).matchAll(pattern)].length;
        return total + calls * Math.max(uses - 1, 0);
      }, 0);
      const inFile = [...file.matchAll(pattern)].length + surplus;
      const inPrograms = compiled
        .reduce((total, program) => total + callsOf(program.glsl, name).length, 0);
      expect(`${name}: ${inPrograms} of ${inFile}`).toBe(`${name}: ${inFile} of ${inFile}`);
      expect(inFile).toBeGreaterThan(0);
    }
  });
});
