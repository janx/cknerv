// Ambient declarations for font assets resolved by bundler (Vite, Rollup).
// `@cknerv/ui` does not bring vite/client types as a dependency so we
// declare the modules explicitly here. The string value at runtime is
// the bundler-rewritten asset URL.
//
// woff2 only, deliberately: every HUD face ships as a hand-subset woff2
// (see `src/fonts/README.md`). Reaching for a full ttf/otf again should
// fail typecheck rather than quietly add a quarter-megabyte to the binary.

declare module '*.woff2' {
  const url: string;
  export default url;
}
