//! Build-time hook that compiles `ui-app/` so the embedded `dist/`
//! folder is populated before `rust-embed` macro-expands.
//!
//! Path math: this build script runs in `crates/cknerv-cli/`. The
//! `ui-app/` dir lives at the workspace root, two `parent()` calls up.
//! `cargo:rerun-if-changed` keys the cache off the ui-app source so
//! editing TS triggers a rebuild but pure Rust edits don't re-invoke
//! pnpm.
//!
//! Prereq: `pnpm` must be on PATH at cargo-build time. Without it,
//! the build fails fast with the underlying spawn error.

use std::process::Command;

fn main() -> anyhow::Result<()> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")?;
    let crate_dir = std::path::PathBuf::from(&manifest_dir);
    let workspace_root = crate_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("crate dir has no two-parent path"))?
        .to_path_buf();
    let ui_app = workspace_root.join("ui-app");

    // Re-run when ui-app source moves. The dist/ output itself is NOT
    // listed — that would create a fixpoint loop (we just wrote it).
    println!(
        "cargo:rerun-if-changed={}",
        ui_app.join("src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        ui_app.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        ui_app.join("vite.config.ts").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        ui_app.join("index.html").display()
    );

    let status = Command::new("pnpm")
        .args(["-F", "cknerv-ui-app", "build"])
        .current_dir(&workspace_root)
        .status()?;
    if !status.success() {
        return Err(anyhow::anyhow!(
            "ui-app build failed; see pnpm output above"
        ));
    }

    Ok(())
}
