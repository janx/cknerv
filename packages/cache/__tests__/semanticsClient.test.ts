import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTransactionSemantics } from '../src/semanticsClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTransactionSemantics', () => {
  it('routes selected transaction lookups through cknerv', async () => {
    const transaction = {
      tx_hash: '0xabc',
      block: 10,
      source: 'ckbadger',
      as_of: { block: 12, hash: '0xanchor' },
      updated_at_ms: 1,
      actions: [],
      participants: [],
      fee: '1000',
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ transaction }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTransactionSemantics('0xabc', {
      baseUrl: 'http://127.0.0.1:17001/',
    })).resolves.toEqual(transaction);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17001/api/enrichment/transactions/0xabc',
      { signal: undefined },
    );
  });

  it('keeps an unindexed transaction optional and surfaces source errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ message: 'validated anchor expired' }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTransactionSemantics('0xmissing')).resolves.toBeNull();
    await expect(fetchTransactionSemantics('0xstale'))
      .rejects.toThrow('validated anchor expired');
  });
});
