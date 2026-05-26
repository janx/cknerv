import type { RenderedLine } from '../components/EventStreamHud';

/**
 * Pure builder: given entries + a per-entry formatter, produce the
 * rendered line list bounded by `limit` (newest-first, i.e. last `limit`
 * entries). Used both by the EventStreamHud render path and by tests
 * to assert iteration / filter / limit semantics without mounting R3F.
 */
export function buildEventLines<Entry>(
  entries: Entry[],
  formatRow: (entry: Entry) => RenderedLine | null,
  limit: number,
): RenderedLine[] {
  const out: RenderedLine[] = [];
  // Mirror the component's render loop: walk newest-first, take up to `limit`.
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const line = formatRow(entries[i]);
    if (line !== null) out.push(line);
  }
  return out;
}
