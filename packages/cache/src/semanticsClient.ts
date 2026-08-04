import type {
  CellSemanticRecord,
  OutPoint,
  TransactionSemanticRecord,
} from '@cknerv/types';

interface CellEnrichmentResponse {
  cell: CellSemanticRecord;
}

interface TransactionEnrichmentResponse {
  transaction: TransactionSemanticRecord;
}

async function enrichmentError(response: Response, subject: string): Promise<Error> {
  let message = `${subject} enrichment failed with HTTP ${response.status}`;
  try {
    const body = await response.json() as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // The HTTP status remains a useful fallback.
  }
  return new Error(message);
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
  if (!response.ok) throw await enrichmentError(response, 'Cell');
  const payload = await response.json() as CellEnrichmentResponse;
  return payload.cell;
}

/** Fetch one selected Cell's origin-transaction semantics through cknerv. */
export async function fetchTransactionSemantics(
  txHash: string,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<TransactionSemanticRecord | null> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/enrichment/transactions/${encodeURIComponent(txHash)}`,
    { signal: options.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await enrichmentError(response, 'Transaction');
  const payload = await response.json() as TransactionEnrichmentResponse;
  return payload.transaction;
}
