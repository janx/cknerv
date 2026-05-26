// Ambient declarations for font assets resolved by bundler (Vite, Rollup).
// `@cknerv/ui` does not bring vite/client types as a dependency so we
// declare the modules explicitly here. The string value at runtime is
// the bundler-rewritten asset URL.

declare module '*.ttf' {
  const url: string;
  export default url;
}

declare module '*.otf' {
  const url: string;
  export default url;
}

declare module '*.woff' {
  const url: string;
  export default url;
}
