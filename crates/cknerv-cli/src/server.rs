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
use std::sync::Arc;

use anyhow::Result;
use cknerv_adapter_ckb::{CkbDirectAdapter, CkbGalaxyCompositionHydrator};
use cknerv_adapter_ckbadger::CkbadgerEnrichmentSource;
use cknerv_core::{
    CellGalaxy, CompositionDemandSink, SemanticsProjection, DEFAULT_REORG_WINDOW_BLOCKS,
};
use cknerv_server::{EnrichmentSource, ServerBuilder};

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
        "cknerv starting: rpc={}, port={}, workdir={}, cell_target={}, replay_block_override={:?}, exact_reorg_blocks={}, enrichment={}",
        cfg.rpc_url,
        cfg.port,
        workdir.display(),
        cfg.galaxy.cell_cap,
        cfg.backfill_blocks,
        DEFAULT_REORG_WINDOW_BLOCKS,
        cfg.ckbadger
            .as_ref()
            .map_or("disabled", |_| "ckbadger"),
    );

    // Restore only when the saved reservoir is known to satisfy the current
    // Cell target. Legacy fixed-window state reports target=0; increasing
    // `cell_cap` also invalidates the old reservoir. In either case start from
    // empty derived state and let the boot checkpoint atomically replace the
    // file. An explicit diagnostic block override likewise requests a fresh
    // one-run replay rather than silently losing to the resume cursor.
    let persisted_cursor = cknerv_server::peek_restored_chain_cursor(&state_dir);
    let restore_persisted = cfg.backfill_blocks.is_none()
        && persisted_cursor
            .as_ref()
            .is_some_and(|cursor| cursor.hydrated_cell_target >= cfg.galaxy.cell_cap);
    if let Some(cursor) = persisted_cursor.as_ref() {
        if !restore_persisted {
            tracing::info!(
                "saved Cell reservoir target {} does not satisfy requested {} (or a replay override is active); rebuilding",
                cursor.hydrated_cell_target,
                cfg.galaxy.cell_cap,
            );
        }
    }
    let resume_cursor = restore_persisted.then_some(persisted_cursor).flatten();
    let resume_tip = resume_cursor.as_ref().map(|cursor| cursor.tip);
    if let Some(tip) = resume_tip {
        tracing::info!(
            "restored state found (tip {tip}); skipping backfill, resuming forward poll"
        );
    }
    let mut adapter = CkbDirectAdapter::new(cfg.rpc_url.clone())
        .with_cell_target(cfg.galaxy.cell_cap)
        .with_reorg_window_blocks(DEFAULT_REORG_WINDOW_BLOCKS as u64)
        .with_resume_from(resume_tip)
        .with_resume_anchors(
            resume_cursor
                .map(|cursor| cursor.recent_blocks)
                .unwrap_or_default(),
        );
    if let Some(blocks) = cfg.backfill_blocks {
        adapter = adapter.with_backfill_blocks(blocks);
    }
    let galaxy_config = cknerv_core::projection::cells::CellGalaxyConfig {
        cell_cap: cfg.galaxy.cell_cap,
        recent_links_cap: cfg.galaxy.recent_links_cap,
        snapshot_scope: cfg.galaxy.snapshot_scope,
        // Forty-eight rollback blocks plus their parent proof fit inside the
        // server's persisted 50-block canonical evidence ring. Deeper changes
        // rebuild the profile-selected replay window instead of keeping every
        // boot mutation in the undo journal.
        reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
    };
    let runtime_galaxy = cfg.galaxy.clone();
    let runtime_enrichment_source = cfg.ckbadger.as_ref().map(|_| "ckbadger");
    let composition_rpc_url = cfg.rpc_url.clone();
    let composition_target = cfg.galaxy.cell_cap;
    let ckbadger_source = cfg
        .ckbadger
        .as_ref()
        .map(|ckbadger| {
            CkbadgerEnrichmentSource::new(ckbadger.api_url.clone()).map(|source| {
                source
                    .with_max_lag_blocks(ckbadger.max_lag_blocks)
                    .with_galaxy_composition_hydrator(
                        CkbGalaxyCompositionHydrator::new(composition_rpc_url.clone()),
                        composition_target,
                    )
            })
        })
        .transpose()?;
    let configured_semantics_source = ckbadger_source
        .as_ref()
        .map(|source| (source.name(), source.capabilities()));

    // One slot, shared: the display plane publishes what its composition
    // is short of, and the enrichment supervisor is the only thing in a
    // position to go find it.
    let composition_demand = Arc::new(CompositionDemandSink::new());
    let mut builder = ServerBuilder::new()
        .add_adapter(adapter)
        .add_projection(
            CellGalaxy::with_config(galaxy_config)
                .with_composition_demand_sink(composition_demand.clone()),
        )
        .add_enrichment_projection(SemanticsProjection::new(configured_semantics_source))
        .composition_demand_sink(composition_demand)
        .workdir(state_dir.clone())
        .restore_persisted(restore_persisted);
    if let Some(source) = ckbadger_source {
        builder = builder.enrichment_source(source);
    }
    let (cknerv_router, handle) = builder.build()?;

    let runtime_config_route = get(move || {
        let runtime_galaxy = runtime_galaxy.clone();
        async move { runtime_config_response(BUILD_VERSION, runtime_galaxy, runtime_enrichment_source) }
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
