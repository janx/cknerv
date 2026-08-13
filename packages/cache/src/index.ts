// @cknerv/cache — pure reducers + WebSocket client for cknerv-server.
//
// All reducers are pure (never mutate input); WS connect helpers take
// a stream URL so consumers can point them at the cknerv-server they're
// targeting (simulator-embedded, cknerv-cli, or a remote host).

export {
  emptyCellsCache,
  fromCellsSnapshot,
  applyCellDelta,
  applyRevisionedCellDeltas,
  cellContentEquals,
  resolveDisplayCell,
  DEFAULT_RECENT_LINKS_CAPACITY,
  DEFAULT_LINK_RING_CAPACITY,
  NO_CELL_CHANGES,
  NO_DISPLAY_CHANGES,
  type ActiveReplayProgress,
  type CanonicalRewriteEcho,
  type CanonicalRewriteMarker,
  type CellChangeSet,
  type CellGalaxyCache,
  type CellsReducerOptions,
  type DisplayBudgetView,
  type DisplayChangeSet,
} from './cellsReducer';

export {
  createCellField,
  cellFieldSlotOf,
  cellFieldUpsert,
  cellFieldRemove,
  clearCellField,
  materializeCellAt,
  syncCellFieldFromCache,
  hydrateCellFieldFromColumnar,
  cellFieldColumnBytes,
  CELL_FIELD_HAS_DATA,
  type CellField,
  type CellFieldSyncResult,
} from './cellField';

export {
  cellsSnapshotFromColumnar,
  decodeCellsColumnar,
  columnarCellAt,
  CELLS_COLUMNAR_VERSION,
  CELLS_COLUMNAR_NO_TAG,
  COLUMNAR_LOCK_KINDS,
  COLUMNAR_ASSET_KINDS,
  type CellsColumnarView,
} from './cellsColumnar';

export {
  aggregateCellsStats,
  cellKindKey,
  cloneCellsStats,
  emptyCellsStats,
  type CellKindKey,
  type CellsStats,
} from './cellsStats';

export {
  emptyChainCache,
  applyChainMutation,
  applyRevisionedChainMutations,
} from './chainReducer';

export {
  emptyChainEntityCache,
  fromEntitiesSnapshot,
  applyEntityDelta,
  connectEntityStream,
  type ChainCache,
  type EntityStreamHandle,
  type EntityStreamOptions,
} from './entityStream';

export {
  connectProjectionStream,
  connectCellsStream,
  connectSemanticsStream,
  type ProjectionStreamHandle,
  type ProjectionStreamOptions,
} from './projectionStream';

export {
  emptySemanticsCache,
  fromSemanticsSnapshot,
  applySemanticsDelta,
  applyRevisionedSemanticsDeltas,
  outPointKey,
  type SemanticsCache,
} from './semanticsReducer';

export { fetchCellSemantics, fetchTransactionSemantics } from './semanticsClient';

export {
  createStreamHealthTracker,
  type StreamHealth,
  type StreamHealthOptions,
  type StreamHealthPhase,
  type StreamHealthReason,
  type StreamHealthTracker,
} from './streamHealth';
