//! `cknerv` — standalone CLI: subcommands `run` / `init` / `prune` under a
//! global `-C/--workdir`. Bare `cknerv` ⇒ `run`. See [`cli`] for flags,
//! [`config`] for cknerv.toml, [`commands`] for init/prune, [`server`] for run.

mod assets;
mod cli;
mod commands;
mod config;
mod open_browser;
mod server;

use clap::Parser;

use crate::cli::{Cli, Command, RunArgs};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let workdir = cli.workdir_path();

    match cli.command.unwrap_or_else(|| Command::Run(RunArgs::default())) {
        Command::Run(args) => {
            let file = config::load(&workdir)?;
            let resolved = config::resolve(
                args.rpc,
                args.port,
                args.no_open,
                args.backfill_blocks,
                &file,
            )?;
            server::run(workdir, resolved).await
        }
        Command::Init => commands::cmd_init(&workdir),
        Command::Prune(args) => commands::cmd_prune(&workdir, args.confirm),
    }
}
