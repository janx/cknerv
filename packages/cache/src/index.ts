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
  type CellStatsScope,
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
  CELLS_COLUMNAR_NO_SCRIPT,
  CELLS_COLUMNAR_NO_TAG,
  CELLS_COLUMNAR_REVISION_OFFSET,
  COLUMNAR_LOCK_KINDS,
  COLUMNAR_ASSET_KINDS,
  COLUMNAR_HASH_TYPES,
  type CellsColumnarView,
} from './cellsColumnar';

export {
  adoptCellViewStats,
  aggregateCellsStats,
  aggregateStageScripts,
  cellKindKey,
  cloneCellsStats,
  emptyCellsStats,
  emptyScriptCensus,
  emptyStageScripts,
  stageScriptCensus,
  STAGE_CENSUS_CAP,
  type CellKindKey,
  type CellsStats,
  type StageScriptTally,
} from './cellsStats';

export {
  emptyChainCache,
  applyChainMutation,
  applyRevisionedChainMutations,
  RECENT_INTERVAL_CAP,
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
  MAX_RETAINED_CELLS,
  MAX_RETAINED_TRANSACTIONS,
  type SemanticsCache,
} from './semanticsReducer';

export {
  cachedPeerSighting,
  clearPeerSightingMemo,
  fetchCellSemantics,
  fetchPeerSighting,
  fetchTransactionSemantics,
  rememberPeerSighting,
  type PeerSightingOutcome,
} from './semanticsClient';

export {
  createStreamHealthTracker,
  type StreamHealth,
  type StreamHealthOptions,
  type StreamHealthPhase,
  type StreamHealthReason,
  type StreamHealthTracker,
} from './streamHealth';
