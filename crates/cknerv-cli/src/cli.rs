//! `clap`-derived CLI for the `cknerv` binary: a global `-C/--workdir`
//! plus `run` / `init` / `purge` subcommands. Bare `cknerv` ⇒ `run`.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use url::Url;

#[derive(Parser, Debug)]
#[command(
    name = "cknerv",
    version,
    about = "Local-first CKB visualization: cells, blocks, transactions, peers"
)]
pub struct Cli {
    /// Work directory (holds cknerv.toml + data/). Default: current directory.
    #[arg(short = 'C', long, value_name = "PATH", global = true)]
    pub workdir: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Start the dashboard server (default).
    Run(RunArgs),
    /// Scaffold the work directory (cknerv.toml + data/).
    Init,
    /// Delete derived data (data/), keep cknerv.toml.
    Purge(PurgeArgs),
}

#[derive(clap::Args, Debug, Default)]
pub struct RunArgs {
    /// CKB JSON-RPC endpoint. Overrides cknerv.toml. Default: http://localhost:8114.
    #[arg(long, value_name = "URL")]
    pub rpc: Option<Url>,

    /// HTTP/WS port for the dashboard SPA. Overrides cknerv.toml. Default: 7001.
    #[arg(long, value_name = "N")]
    pub port: Option<u16>,

    /// Suppress the auto-open-browser behavior.
    #[arg(long)]
    pub no_open: bool,

    /// One-run hard block limit for target-driven boot/rebuild hydration.
    /// Without it, cknerv scans until the built-in live-cell reservoir
    /// target (50,000) or genesis.
    /// 0 disables historical boot replay.
    #[arg(long, value_name = "N")]
    pub backfill_blocks: Option<u64>,
}

#[derive(clap::Args, Debug)]
pub struct PurgeArgs {
    /// Confirm the destructive delete of data/.
    #[arg(long)]
    pub confirm: bool,
}

impl Cli {
    /// Resolved workdir — flag value if present, else the current directory.
    pub fn workdir_path(&self) -> PathBuf {
        self.workdir
            .clone()
            .unwrap_or_else(|| std::env::current_dir().expect("cannot determine current directory"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn bare_invocation_has_no_subcommand_and_defaults_workdir_to_cwd() {
        let cli = Cli::parse_from(["cknerv"]);
        assert!(cli.command.is_none());
        assert_eq!(cli.workdir_path(), std::env::current_dir().unwrap());
    }

    #[test]
    fn run_parses_overrides() {
        let cli = Cli::parse_from([
            "cknerv",
            "run",
            "--rpc",
            "http://x:1",
            "--port",
            "9",
            "--no-open",
            "--backfill-blocks",
            "5",
        ]);
        match cli.command {
            Some(Command::Run(a)) => {
                assert_eq!(a.rpc.unwrap().as_str(), "http://x:1/");
                assert_eq!(a.port, Some(9));
                assert!(a.no_open);
                assert_eq!(a.backfill_blocks, Some(5));
            }
            other => panic!("expected Run, got {other:?}"),
        }
    }

    #[test]
    fn purge_confirm_flag() {
        let no = Cli::parse_from(["cknerv", "purge"]);
        assert!(matches!(
            no.command,
            Some(Command::Purge(PurgeArgs { confirm: false }))
        ));
        let yes = Cli::parse_from(["cknerv", "purge", "--confirm"]);
        assert!(matches!(
            yes.command,
            Some(Command::Purge(PurgeArgs { confirm: true }))
        ));
    }

    #[test]
    fn prune_is_not_a_subcommand() {
        assert!(Cli::try_parse_from(["cknerv", "prune"]).is_err());
    }

    #[test]
    fn global_workdir_accepted_before_and_after_subcommand() {
        let before = Cli::parse_from(["cknerv", "-C", "/tmp/wd", "init"]);
        assert_eq!(before.workdir, Some(PathBuf::from("/tmp/wd")));
        assert!(matches!(before.command, Some(Command::Init)));

        let after = Cli::parse_from(["cknerv", "run", "--workdir", "/tmp/wd2"]);
        assert_eq!(after.workdir, Some(PathBuf::from("/tmp/wd2")));
    }
}
