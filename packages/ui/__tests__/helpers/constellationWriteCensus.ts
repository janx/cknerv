// What the frame writer actually wrote, and what the tree says afterwards.
//
// Two instruments on one stage. The CENSUS counts every attribute, style and
// dataset write the writer makes and says which of them set a value that was
// already there — a same-value write costs a parse, a CSSOM compare and, for a
// dataset, a MutationRecord, and none of it is a picture. The STATE serialises
// the whole tree the writer owns, so a task that claims to write less can be
// held to writing the same thing.
//
// The census instruments the elements THEMSELVES (own properties shadowing the
// prototype accessors), not the prototypes: a suite that patched
// `CSSStyleDeclaration.prototype` would be measuring every other element in
// the document too.
import { CONSTELLATION_SLOTS } from '../../src/components/hud/cellConstellationFrame';
import type { ConstellationStage } from './constellationStage';

export interface WriteCensus {
  /** Writes that changed the value. */
  changed: number;
  /** Writes that set the value the element already had. */
  same: number;
  /** `<element>.<property>` → [changed, same]. */
  byKey: { [key: string]: [number, number] };
  reset(): void;
  total(): number;
}

function createCensus(): WriteCensus {
  const census: WriteCensus = {
    changed: 0,
    same: 0,
    byKey: {},
    reset() {
      census.changed = 0;
      census.same = 0;
      for (const key of Object.keys(census.byKey)) delete census.byKey[key];
    },
    total() { return census.changed + census.same; },
  };
  return census;
}

function record(census: WriteCensus, key: string, same: boolean): void {
  const entry = census.byKey[key] ?? (census.byKey[key] = [0, 0]);
  if (same) { census.same += 1; entry[1] += 1; } else { census.changed += 1; entry[0] += 1; }
}

function instrument(
  element: HTMLElement | SVGElement,
  label: string,
  census: WriteCensus,
): void {
  const setAttribute = element.setAttribute.bind(element);
  const removeAttribute = element.removeAttribute.bind(element);
  Object.defineProperty(element, 'setAttribute', {
    configurable: true,
    value: (name: string, value: string) => {
      record(census, `${label}.@${name}`, element.getAttribute(name) === `${value}`);
      setAttribute(name, value);
    },
  });
  Object.defineProperty(element, 'removeAttribute', {
    configurable: true,
    value: (name: string) => {
      record(census, `${label}.-@${name}`, !element.hasAttribute(name));
      removeAttribute(name);
    },
  });
  const replaceChildren = element.replaceChildren.bind(element);
  Object.defineProperty(element, 'replaceChildren', {
    configurable: true,
    value: (...nodes: Node[]) => {
      record(census, `${label}.replaceChildren`, false);
      replaceChildren(...nodes);
    },
  });
  const style = element.style as unknown as Record<string, unknown>;
  Object.defineProperty(element, 'style', {
    configurable: true,
    value: new Proxy(style, {
      get(target, property) {
        const value = target[property as string];
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, property, value) {
        record(census, `${label}.$${String(property)}`, target[property as string] === value);
        target[property as string] = value;
        return true;
      },
    }),
  });
  const data = element.dataset as unknown as Record<string, string | undefined>;
  Object.defineProperty(element, 'dataset', {
    configurable: true,
    value: new Proxy(data, {
      get(target, property) { return target[property as string]; },
      set(target, property, value) {
        record(census, `${label}.#${String(property)}`, target[property as string] === value);
        target[property as string] = value as string;
        return true;
      },
      deleteProperty(target, property) {
        record(census, `${label}.-#${String(property)}`,
          target[property as string] === undefined);
        delete target[property as string];
        return true;
      },
    }),
  });
}

/** Instrument every element the writer owns on this stage. Call it before the
 *  first frame: the stage's elements are created once and never replaced, so
 *  the own properties stay in place for the run. */
export function censusConstellationWrites(stage: ConstellationStage): WriteCensus {
  const census = createCensus();
  const { handles } = stage;
  if (handles.root) instrument(handles.root, 'root', census);
  if (handles.reticle) instrument(handles.reticle, 'reticle', census);
  if (handles.chip) instrument(handles.chip, 'chip', census);
  if (handles.maskGroup) instrument(handles.maskGroup, 'masks', census);
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    if (panel.host) instrument(panel.host, `${slot}.host`, census);
    if (panel.fallbackLabel) instrument(panel.fallbackLabel, `${slot}.fallback`, census);
    const leader = handles.leaders[slot];
    if (leader.group) instrument(leader.group, `${slot}.group`, census);
    if (leader.under) instrument(leader.under, `${slot}.under`, census);
    if (leader.over) instrument(leader.over, `${slot}.over`, census);
    if (leader.dot) instrument(leader.dot, `${slot}.dot`, census);
    if (leader.label) instrument(leader.label, `${slot}.label`, census);
  }
  return census;
}

const styleOf = (
  element: HTMLElement | SVGElement | null,
  ...properties: string[]
): string => {
  if (!element) return '-';
  const style = element.style as unknown as Record<string, string>;
  return properties.map((property) => `${property}=${style[property] ?? ''}`).join(' ');
};

const dataOf = (element: HTMLElement | SVGElement | null): string => {
  if (!element) return '-';
  const data = element.dataset as unknown as Record<string, string>;
  return Object.keys(data).sort().map((key) => `${key}=${data[key]}`).join(' ');
};

/**
 * Everything the writer owns on this stage, as one line.
 *
 * Ordered by element and then by property name so that two runs of the same
 * scenario produce the same bytes, and so that a line which moved names what
 * moved rather than merely differing.
 */
export function constellationDomState(stage: ConstellationStage): string {
  const { handles } = stage;
  const parts: string[] = [];
  parts.push(`root{${dataOf(handles.root)}|${styleOf(handles.root, 'opacity')}}`);
  parts.push(`reticle{${styleOf(handles.reticle, 'transform')}}`);
  parts.push(`chip{${styleOf(handles.chip, 'transform')}}`);
  for (const slot of CONSTELLATION_SLOTS) {
    const panel = handles.panels[slot];
    const leader = handles.leaders[slot];
    parts.push(`${slot}.host{${dataOf(panel.host)}|${styleOf(panel.host, 'transform', 'width', 'height', 'visibility')}}`);
    parts.push(`${slot}.fallback{${styleOf(panel.fallbackLabel, 'visibility', 'position', 'maxWidth', 'padding', 'borderWidth')}}`);
    parts.push(`${slot}.group{${dataOf(leader.group)}}`);
    parts.push(`${slot}.under{d=${leader.under?.getAttribute('d') ?? '-'}|${styleOf(leader.under, 'visibility')}}`);
    parts.push(`${slot}.over{d=${leader.over?.getAttribute('d') ?? '-'}|${styleOf(leader.over, 'visibility')}}`);
    parts.push(`${slot}.dot{cx=${leader.dot?.getAttribute('cx') ?? '-'} cy=${leader.dot?.getAttribute('cy') ?? '-'}|${styleOf(leader.dot, 'display', 'visibility')}}`);
    parts.push(`${slot}.label{${styleOf(leader.label, 'display', 'transform', 'visibility')}}`);
  }
  const cuts = handles.maskGroup
    ? Array.from(handles.maskGroup.children).map((node) => [
      node.getAttribute('x'), node.getAttribute('y'),
      node.getAttribute('width'), node.getAttribute('height'),
      node.getAttribute('fill'),
    ].join(',')).join(';')
    : '-';
  parts.push(`masks{${cuts}}`);
  return parts.join(' ');
}
