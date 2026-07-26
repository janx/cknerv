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
  DEFAULT_RECENT_LINKS_CAPACITY,
  DEFAULT_LINK_RING_CAPACITY,
  type CellGalaxyCache,
  type CellsReducerOptions,
} from './cellsReducer';

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
  type ProjectionStreamHandle,
  type ProjectionStreamOptions,
} from './projectionStream';
