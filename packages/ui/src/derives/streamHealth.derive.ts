import type {
  StreamHealth,
  StreamHealthPhase,
} from '@cknerv/cache';

export interface StreamHealthChannels {
  chain: StreamHealth;
  cells: StreamHealth;
  /** Present only when enrichment is enabled — the semantics stream is
   * optional by design, but once it exists its outages must surface here
   * like any other transport instead of freezing five panels silently. */
  semantics?: StreamHealth;
  /**
   * The hop the browser cannot see: cknerv → the CKB node.
   *
   * The three above are the browser's own sockets, and all three stay
   * perfectly live while the node behind the server is gone — the server
   * heartbeats a frozen tip at them. The outage therefore surfaced two and a
   * half minutes later as a chain STALL: the most likely real fault of a
   * local-first tool, reported as a different fault, late (report E, E-7).
   *
   * Absent when `/api/health` cannot be read at all, which is not this
   * channel's story to tell: a server that will not answer is exactly what
   * the sockets above are already saying, and a second banner for it would be
   * two voices on one emergency. Absent is the same word `semantics` uses for
   * "there is nothing here to report on".
   *
   * It carries a `fault` beside its phase, because the hop has TWO ways of
   * being unwell and the register cannot tell them apart — see `NodeFault`.
   */
  node?: NodeStreamHealth;
}

/** The fields of `/api/health` this channel reads. The endpoint reports a
 *  dozen more; naming only these four is the contract, and it is why nothing
 *  in `packages/types` had to grow a wire type for a body the page treats as a
 *  vital-signs probe rather than as data. */
export interface NodeHealthProbe {
  /** True when any watched task has died or any projection is quarantined —
   *  the server's own single field for "something is wrong with me". */
  degraded: boolean;
  /** One entry per registered adapter. THE adapter is the thing that talks to
   *  the CKB node, so this is the reading; `degraded` is the gate above it. */
  adapters: ReadonlyArray<{ name: string; alive: boolean }>;
  /** Age of the tip block by its OWN timestamp, `null` until one is seen. */
  tipAgeMs: number | null;
  /** The quarantined subset of the server's projections, by name — its own
   *  one-field answer to "is a view of the chain no longer being built".
   *  Empty is the healthy reading, and the field is not optional: a body that
   *  omitted it would be read as "nothing is quarantined", and the caller that
   *  maps the wire is where a missing field gets its meaning. */
  quarantinedProjections: readonly string[];
}

/**
 * WHY the node's hop is frozen, when the page can say.
 *
 * The phase is the REGISTER — frozen, danger, the breathing frame — and both
 * of these wear it. What they do not share is the sentence, and the sentence
 * is the whole reason this type exists: an operator who reads NODE UNREACHABLE
 * goes and looks at their node, and one who reads PROJECTION QUARANTINED goes
 * and looks at the server's log. Two errands, two words.
 *
 * They are RANKED, and the ranking is decided here rather than in the banner,
 * because it is a fact about the readings and not about the drawing: an
 * adapter that died has taken the whole chain with it, and a quarantined
 * projection has taken one view of it. When both are true the graver one is
 * the one worth an errand.
 */
export type NodeFault =
  | { kind: 'unreachable' }
  | { kind: 'quarantined'; projections: readonly string[] };

/** The node channel's health, which is a transport phase plus the one thing
 *  no socket lifecycle has a field for: a cause the page actually knows. */
export interface NodeStreamHealth extends StreamHealth {
  /** `null` while the hop is nominal — a live channel has nothing to explain. */
  fault: NodeFault | null;
}

/**
 * Whether a fresh node reading is a LIFECYCLE event — a change in what this
 * channel actually says — rather than the same answer re-derived.
 *
 * This is the node hop's copy of the rule the three socket trackers already
 * keep (`@cknerv/cache`'s `lifecycleChanged`): phase, reason and — here —
 * the fault are the whole rendered surface, and `lastMessageAtMs` is
 * deliberately excluded. That stamp is `now − tipAgeMs`, so it moves on every
 * single poll; publishing for it re-rendered App, the HUD and (before the
 * inspection hold was fixed) both scene roots twice a second for a number
 * with no rendered output while the node is live — the banner returns null
 * outright until a channel leaves `live` (report L6-6).
 *
 * The stamp is not lost: the caller keeps the latest reading internally and
 * the next lifecycle publish carries it, which is exactly the "last frame"
 * instant an age readout wants when a channel finally has something to say.
 *
 * `null` is a reading too — "the server will not answer, and that is the
 * SOCKETS' story" — so null → null is not an event either.
 */
export function nodeStreamHealthLifecycleChanged(
  previous: NodeStreamHealth | null,
  next: NodeStreamHealth | null,
): boolean {
  if (previous === null || next === null) return previous !== next;
  if (previous.phase !== next.phase || previous.reason !== next.reason) {
    return true;
  }
  return nodeFaultChanged(previous.fault, next.fault);
}

function nodeFaultChanged(
  previous: NodeFault | null,
  next: NodeFault | null,
): boolean {
  if (previous === null || next === null) return previous !== next;
  if (previous.kind !== next.kind) return true;
  // A quarantine is a NAMED list and the banner prints the names, so two
  // quarantines of different views are two different sentences.
  if (previous.kind !== 'quarantined' || next.kind !== 'quarantined') {
    return false;
  }
  return previous.projections.length !== next.projections.length
    || previous.projections.some((name, i) => name !== next.projections[i]);
}

/**
 * The node's hop as a transport phase.
 *
 * It has two states and no dwell, because the supervisor it reads has none to
 * add: `spawn_supervisor` flips an adapter dead within 250 ms of the task
 * exiting and never flips it back — a dead task stays dead for the life of the
 * process — so a single reading is already a settled one. Debouncing it would
 * only delay a fault that is by then permanent.
 *
 * `stale` and not `retrying`: nothing is being retried by anyone the page can
 * see, and the register the reader needs is the frozen one. The banner's word
 * over that register is the node's own (`NODE UNREACHABLE`) — same colour,
 * same frame, different sentence, because a cause outranks its consequence.
 *
 * ⚠️ `degraded` is NOT the reading, on either half. It is true for a dead
 * adapter and true for a quarantined projection, and those are two different
 * errands, so each is read off the field that states it and `degraded` is only
 * the gate that says one of them is worth reading. A quarantined projection
 * used to leave this channel LIVE for exactly that reason — it is not the
 * node's fault — and the correction is not to blame the node for it but to
 * give it its own word: the channel is the one surface on the page that speaks
 * for the server's own condition, and a view of the chain that is no longer
 * being built is a frozen reading whoever's fault it is.
 */
export function deriveNodeStreamHealth(
  probe: NodeHealthProbe,
  nowMs: number,
): NodeStreamHealth {
  const reachable = !probe.degraded
    || probe.adapters.every((adapter) => adapter.alive);
  const quarantined = probe.degraded ? probe.quarantinedProjections : [];
  const fault: NodeFault | null = !reachable
    ? { kind: 'unreachable' }
    : quarantined.length > 0
      ? { kind: 'quarantined', projections: [...quarantined] }
      : null;
  // The tip's own age, carried as the freshness stamp rather than as a second
  // alarm. A tip that stops advancing while every adapter lives is a CHAIN
  // fault, and the ECG already names it FLATLINE at its own threshold — two
  // surfaces alarming on one fact is the thing the severity rule forbids. Here
  // it is the number that fills `LAST FRAME`, which is the reading a frozen
  // band most wants beside it.
  const lastMessageAtMs = probe.tipAgeMs === null
    ? null
    : nowMs - Math.max(0, probe.tipAgeMs);
  return {
    phase: fault === null ? 'live' : 'stale',
    attempt: 0,
    lastMessageAtMs,
    // A dead adapter is a socket the server lost — `closed`, the same word the
    // browser's own trackers use for it. A quarantined projection closed
    // nothing: it is a view that stopped keeping up with the mutations behind
    // it, which is what `lagged` already means everywhere else in this type.
    reason: fault === null
      ? null
      : fault.kind === 'unreachable' ? 'closed' : 'lagged',
    fault,
  };
}

export interface StreamHealthSummary {
  phase: StreamHealthPhase;
  affectedChannels: Array<keyof StreamHealthChannels>;
  lastMessageAgeMs: number | null;
  attempt: number;
  /** Carried through untouched from the node channel, because the summary is
   *  the only thing the banner is handed and the banner is where a sentence is
   *  chosen. Folding it into `phase` would lose it; folding it into
   *  `affectedChannels` would make a cause into a channel name. */
  nodeFault: NodeFault | null;
}

const PHASE_PRIORITY: Record<StreamHealthPhase, number> = {
  live: 0,
  connecting: 1,
  retrying: 2,
  resyncing: 3,
  stale: 4,
};

type StreamHealthEntry = [keyof StreamHealthChannels, StreamHealth];

function presentChannels(channels: StreamHealthChannels): StreamHealthEntry[] {
  return (Object.entries(channels) as Array<
    [keyof StreamHealthChannels, StreamHealth | undefined]
  >).filter(
    (entry): entry is StreamHealthEntry => entry[1] !== undefined,
  );
}

function worstPhase(entries: readonly StreamHealthEntry[]): StreamHealthPhase {
  return entries.reduce<StreamHealthPhase>(
    (worst, [, health]) => (
      PHASE_PRIORITY[health.phase] > PHASE_PRIORITY[worst]
        ? health.phase
        : worst
    ),
    'live',
  );
}

/** The worst transport phase alone — the half of the summary that needs no
 * clock. The overlay lays its rails out under this word, so it must not be
 * paid for with a per-second render; the silence beside it is the banner's
 * own leaf (`deriveStreamHealthSummary`). */
export function deriveStreamHealthPhase(
  channels: StreamHealthChannels,
): StreamHealthPhase {
  return worstPhase(presentChannels(channels));
}

/** Collapse independent chain/cells transports without confusing their state
 * with CKB node sync. The worst transport phase wins; channel attribution
 * remains explicit so a healthy stream is never painted as failed. */
export function deriveStreamHealthSummary(
  channels: StreamHealthChannels,
  nowMs: number,
): StreamHealthSummary {
  const entries = presentChannels(channels);
  const phase = worstPhase(entries);
  const interrupted = entries.filter(([, health]) => health.phase !== 'live');
  const affectedChannels = interrupted.map(([name]) => name);
  // Only an interrupted channel's silence is measurable: a live tracker
  // publishes lifecycle changes only, so its stamp is frozen at the instant it
  // went live and would drag the aggregate arbitrarily far back. With every
  // channel live nothing renders the age, so the aggregate stands.
  const measurable = interrupted.length > 0 ? interrupted : entries;
  const measured = measurable
    .map(([, health]) => health.lastMessageAtMs)
    .filter((at): at is number => at !== null);
  const lastMessageAgeMs = measured.length === measurable.length
    ? Math.max(0, nowMs - Math.min(...measured))
    : null;
  return {
    phase,
    affectedChannels,
    lastMessageAgeMs,
    attempt: Math.max(...entries.map(([, health]) => health.attempt)),
    nodeFault: channels.node?.fault ?? null,
  };
}

export function formatStreamAge(ageMs: number | null): string {
  if (ageMs === null) return 'AWAITING FRAME';
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  // Uppercase, with `formatAge` and `formatLinkUptime`: the HUD prints one
  // time unit in one case (report A, A-13).
  if (seconds < 60) return `${seconds}S`;
  return `${Math.floor(seconds / 60)}M ${seconds % 60}S`;
}

export function formatStreamChannels(
  channels: readonly (keyof StreamHealthChannels)[],
): string {
  return channels.length === 0
    ? 'CHAIN + CELLS'
    : channels.map((channel) => channel.toUpperCase()).join(' + ');
}
