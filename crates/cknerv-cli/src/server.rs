//! Boot wiring: assembles `cknerv-server` + `CkbDirectAdapter` +
//! `CellGalaxy` projection, mounts the SPA fallback, binds the listener,
//! optionally auto-opens the browser, then waits for Ctrl-C.
//!
//! The composed router is `cknerv-server`'s chain-generic API
//! (`/api/entities/chain/...`, `/api/projections/...`) plus an axum
//! fallback that serves the embedded SPA — single port, single
//! listener, no CORS dance.

use std::net::SocketAddr;

use anyhow::Result;
use cknerv_adapter_ckb::CkbDirectAdapter;
use cknerv_core::CellGalaxy;
use cknerv_server::ServerBuilder;

use crate::assets::serve_spa;
use crate::cli::Cli;

pub async fn boot(cli: Cli) -> Result<()> {
    // tracing init — `RUST_LOG` env var picks granularity, default INFO.
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .init();

    let rpc_url = cli.rpc_url();
    let port = cli.port;
    let workdir = cli.workdir_path();

    tracing::info!(
        "cknerv starting: rpc={rpc_url}, port={port}, workdir={}",
        workdir.display()
    );

    // Workdir is hydrated on boot by ServerBuilder::build via
    // persistence::load; create it now so the load is a clean
    // "no prior state" instead of an IO error on a missing dir.
    std::fs::create_dir_all(&workdir)?;

    let adapter = CkbDirectAdapter::new(rpc_url.clone());

    let (cknerv_router, handle) = ServerBuilder::new()
        .add_adapter(adapter)
        .add_projection(CellGalaxy::new())
        .workdir(workdir)
        .build()?;

    // Compose: cknerv-server's API routes + SPA fallback. Anything not
    // matched by cknerv-server (which scopes to `/api/...`) falls
    // through to serve_spa, which returns index.html for extension-less
    // paths and embedded asset bytes otherwise.
    let app = cknerv_router.fallback(serve_spa);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("dashboard at http://localhost:{port}");
    if !cli.no_open {
        crate::open_browser::open(port);
    }

    let server_task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("axum::serve exited with error: {e}");
        }
    });

    // Block on Ctrl-C. tokio installs the handler on first poll, so the
    // shutdown sequence below only fires once an interactive operator
    // signals exit.
    tokio::signal::ctrl_c().await?;
    tracing::info!("Ctrl-C received, shutting down...");

    handle.shutdown().await;
    server_task.abort();

    Ok(())
}
