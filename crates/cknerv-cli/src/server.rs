//! Boot wiring: assembles `cknerv-server` + `CkbDirectAdapter` +
//! `CellGalaxy` projection, mounts the SPA fallback, binds the listener,
//! optionally auto-opens the browser, then waits for Ctrl-C.
//!
//! Derived state lives under `<workdir>/data/`; the server is handed that
//! data dir as its workdir, so `cknerv-server` persistence writes
//! `cknerv-state.json` there. The chain-generic API routes plus an axum
//! SPA fallback share a single port.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Result;
use cknerv_adapter_ckb::CkbDirectAdapter;
use cknerv_core::CellGalaxy;
use cknerv_server::ServerBuilder;

use axum::routing::get;

use crate::assets::{runtime_config_response, serve_spa, BUILD_VERSION};
use crate::config::ResolvedConfig;

pub async fn run(workdir: PathBuf, cfg: ResolvedConfig) -> Result<()> {
    // tracing init — `RUST_LOG` env var picks granularity, default INFO.
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(env_filter).init();

    // Derived state goes under <workdir>/data/. Hand the server that dir as
    // its workdir; persistence writes cknerv-state.json there.
    let state_dir = workdir.join("data");
    std::fs::create_dir_all(&state_dir)?;

    tracing::info!(
        "cknerv starting: rpc={}, port={}, workdir={}",
        cfg.rpc_url,
        cfg.port,
        workdir.display()
    );

    // If persisted state exists, skip the boot backfill and resume the
    // forward poll from the saved tip (ServerBuilder::build hydrates the
    // restored galaxy from the same file).
    let resume_cursor = cknerv_server::peek_restored_chain_cursor(&state_dir);
    let resume_tip = resume_cursor.as_ref().map(|cursor| cursor.tip);
    if let Some(tip) = resume_tip {
        tracing::info!(
            "restored state found (tip {tip}); skipping backfill, resuming forward poll"
        );
    }
    let adapter = CkbDirectAdapter::new(cfg.rpc_url.clone())
        .with_backfill_blocks(cfg.backfill_blocks)
        .with_resume_from(resume_tip)
        .with_resume_anchors(
            resume_cursor
                .map(|cursor| cursor.recent_blocks)
                .unwrap_or_default(),
        );
    let galaxy_config = cknerv_core::projection::cells::CellGalaxyConfig {
        cell_cap: cfg.galaxy.cell_cap,
        recent_links_cap: cfg.galaxy.recent_links_cap,
        // The cell undo journal and the adapter's canonical anchors share the
        // same horizon. Even with boot backfill disabled, retain two live
        // blocks so ordinary one-block reorgs can still roll back exactly.
        reorg_window_blocks: usize::try_from(cfg.backfill_blocks.max(2)).unwrap_or(usize::MAX),
    };
    let runtime_galaxy = cfg.galaxy.clone();

    let (cknerv_router, handle) = ServerBuilder::new()
        .add_adapter(adapter)
        .add_projection(CellGalaxy::with_config(galaxy_config))
        .workdir(state_dir.clone())
        .build()?;

    let runtime_config_route = get(move || {
        let runtime_galaxy = runtime_galaxy.clone();
        async move { runtime_config_response(BUILD_VERSION, runtime_galaxy) }
    });
    let app = cknerv_router
        .route("/runtime-config.js", runtime_config_route)
        .fallback(serve_spa);

    let addr = SocketAddr::from(([127, 0, 0, 1], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("dashboard at http://localhost:{}", cfg.port);
    if cfg.open {
        crate::open_browser::open(cfg.port);
    }

    let server_task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("axum::serve exited with error: {e}");
        }
    });

    tokio::signal::ctrl_c().await?;
    tracing::info!("Ctrl-C received, shutting down...");

    // Persist BEFORE shutdown: `save` borrows `&self`, `shutdown` consumes
    // `self`. Next boot's peek_restored_tip resumes instead of re-backfilling.
    match handle.save() {
        Ok(()) => tracing::info!("state persisted to {}", state_dir.display()),
        Err(e) => tracing::warn!("failed to persist state on exit: {e}"),
    }

    handle.shutdown().await;
    server_task.abort();

    Ok(())
}
