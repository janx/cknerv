/** Production Time-knob snapshot. Exactly ONE leva subscription — the mounted
 * SimClockTicker's — writes it; every useSimFrame consumer reads it inside its
 * frame callback instead of holding its own `useControls('Time')` store
 * subscription (which made a knob drag re-render every consumer, ~2 per peer,
 * and paid one leva hook per instance every frame). Defaults match the leva
 * schema, so a closed panel — or a Canvas without a ticker, where the sim
 * clock never advances anyway — behaves byte-identically to before. */
export const productionTimeControls = { paused: false, timeScale: 1 };
