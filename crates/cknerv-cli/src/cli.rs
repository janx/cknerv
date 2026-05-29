//! `clap`-derived CLI for the `cknerv` binary.
//!
//! Five flags only — keeps the MVP weather-station ergonomics tight.
//! Resolution of optional flags (rpc / workdir) lives on the [`Cli`]
//! struct so [`crate::server`] reads a single canonical value rather
//! than re-deriving defaults in two places.

use clap::Parser;
use std::path::PathBuf;
use url::Url;

#[derive(Parser, Debug)]
#[command(
    name = "cknerv",
    version,
    about = "CKB chain visualization weather station"
)]
pub struct Cli {
    /// CKB JSON-RPC endpoint. Default: http://localhost:8114.
    #[arg(long, value_name = "URL")]
    pub rpc: Option<Url>,

    /// HTTP/WS port for the dashboard SPA. Default: 7001.
    #[arg(long, default_value_t = 7001)]
    pub port: u16,

    /// Suppress the auto-open-browser behavior.
    #[arg(long)]
    pub no_open: bool,

    /// Workdir for persisted state. Default: ~/.cknerv.
    #[arg(long, value_name = "PATH")]
    pub workdir: Option<PathBuf>,

    /// Recent blocks to replay at boot to seed the live-cell galaxy.
    /// 0 disables (galaxy fills only from new blocks). Default: 1000.
    #[arg(long, value_name = "N", default_value_t = 1000)]
    pub backfill_blocks: u64,
}

impl Cli {
    /// Resolved RPC URL — flag value if present, otherwise the local
    /// CKB convention `http://localhost:8114`.
    pub fn rpc_url(&self) -> Url {
        self.rpc.clone().unwrap_or_else(|| {
            // The default URL is a compile-time constant; parse failure
            // is structurally impossible. Express the invariant via
            // `expect` so a future edit that breaks the string surfaces
            // immediately rather than via a generic Result chain.
            Url::parse("http://localhost:8114").expect("static URL")
        })
    }

    /// Resolved workdir — flag value if present, otherwise `~/.cknerv`.
    /// Falls through to `/tmp/.cknerv` only when `$HOME` is unset, which
    /// would only happen on a misconfigured environment.
    pub fn workdir_path(&self) -> PathBuf {
        self.workdir.clone().unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home).join(".cknerv")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn backfill_blocks_defaults_to_1000_and_parses_override() {
        let def = Cli::parse_from(["cknerv"]);
        assert_eq!(def.backfill_blocks, 1000);

        let zero = Cli::parse_from(["cknerv", "--backfill-blocks", "0"]);
        assert_eq!(zero.backfill_blocks, 0);

        let n = Cli::parse_from(["cknerv", "--backfill-blocks", "300"]);
        assert_eq!(n.backfill_blocks, 300);
    }
}
