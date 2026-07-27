//! `clap`-derived CLI for the `cknerv` binary: a global `-C/--workdir`
//! plus `run` / `init` / `prune` subcommands. Bare `cknerv` ⇒ `run`.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use url::Url;

#[derive(Parser, Debug)]
#[command(
    name = "cknerv",
    version,
    about = "CKB chain visualization weather station"
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
    Prune(PruneArgs),
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

    /// Recent blocks used for boot replay and the reorg/rebuild window. 0
    /// disables historical replay (a minimal live reorg journal remains).
    /// Overrides cknerv.toml. Default: 2000.
    #[arg(long, value_name = "N")]
    pub backfill_blocks: Option<u64>,
}

#[derive(clap::Args, Debug)]
pub struct PruneArgs {
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
    fn prune_confirm_flag() {
        let no = Cli::parse_from(["cknerv", "prune"]);
        assert!(matches!(
            no.command,
            Some(Command::Prune(PruneArgs { confirm: false }))
        ));
        let yes = Cli::parse_from(["cknerv", "prune", "--confirm"]);
        assert!(matches!(
            yes.command,
            Some(Command::Prune(PruneArgs { confirm: true }))
        ));
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
