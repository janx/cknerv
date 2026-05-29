//! `cknerv` — standalone CLI that boots a local cknerv-server pointed at
//! a CKB node and serves the embedded SPA on the same port.
//!
//! See [`cli`] for flag definitions and [`server`] for the boot
//! sequence. The binary is a thin shell around those two modules.

mod assets;
mod cli;
mod commands;
mod config;
mod open_browser;
mod server;

use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = cli::Cli::parse();
    server::boot(cli).await
}
