// A structural WebGL2 timer-query context for the GPU probe tests: query
// objects that complete on demand, a switchable disjoint flag, a switchable
// context-loss flag, and counters for what the core created and deleted.

export interface FakeQuery {
  id: number;
}

export class FakeTimerQueryContext {
  readonly QUERY_RESULT_AVAILABLE = 0x8867;

  readonly QUERY_RESULT = 0x8866;

  readonly extension = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb,
  };

  extensionAvailable = true;

  disjoint = false;

  lost = false;

  throwOnBegin = false;

  deletedQueries = 0;

  /** The id the next created query takes: `nextId - 1` is how many were
   *  created so far. */
  nextId = 1;

  active: FakeQuery | null = null;

  readonly queries = new Map<FakeQuery, { available: boolean; resultNs: number }>();

  getExtension(name: string): unknown {
    return name === 'EXT_disjoint_timer_query_webgl2' && this.extensionAvailable
      ? this.extension
      : null;
  }

  createQuery(): FakeQuery {
    const query = { id: this.nextId };
    this.nextId += 1;
    this.queries.set(query, { available: false, resultNs: 0 });
    return query;
  }

  deleteQuery(query: object): void {
    this.deletedQueries += 1;
    this.queries.delete(query as FakeQuery);
  }

  beginQuery(_target: number, query: object): void {
    if (this.throwOnBegin) throw new Error('begin rejected');
    // A reused query starts over, exactly as the GL spec resets a query
    // object's result on BeginQuery.
    const state = this.queries.get(query as FakeQuery);
    if (state) {
      state.available = false;
      state.resultNs = 0;
    }
    this.active = query as FakeQuery;
  }

  endQuery(): void {
    this.active = null;
  }

  getQueryParameter(query: object, pname: number): unknown {
    const state = this.queries.get(query as FakeQuery);
    if (!state) throw new Error('unknown query');
    if (pname === this.QUERY_RESULT_AVAILABLE) return state.available;
    if (pname === this.QUERY_RESULT) return state.resultNs;
    throw new Error('unknown query parameter');
  }

  getParameter(pname: number): unknown {
    if (pname === this.extension.GPU_DISJOINT_EXT) return this.disjoint;
    throw new Error('unknown parameter');
  }

  isContextLost(): boolean {
    return this.lost;
  }

  completeAll(resultNs: number): void {
    for (const state of this.queries.values()) {
      state.available = true;
      state.resultNs = resultNs;
    }
  }
}
