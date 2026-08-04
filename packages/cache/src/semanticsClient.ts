import type { CellSemanticRecord, OutPoint } from '@cknerv/types';

interface CellEnrichmentResponse {
  cell: CellSemanticRecord;
}

/** Fetch selected-Cell semantics through cknerv. Browsers never contact the
 * configured ckbadger service directly. */
export async function fetchCellSemantics(
  outPoint: OutPoint,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CellSemanticRecord | null> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/enrichment/cells/${encodeURIComponent(outPoint.tx_hash)}/${outPoint.index}`,
    { signal: options.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    let message = `Cell enrichment failed with HTTP ${response.status}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // The HTTP status remains a useful fallback.
    }
    throw new Error(message);
  }
  const payload = await response.json() as CellEnrichmentResponse;
  return payload.cell;
}
