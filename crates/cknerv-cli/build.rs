//! Build-time hook that compiles `ui-app/` for rust-embed and emits
//! `CKNERV_BUILD_VERSION` for the dashboard runtime config.

#[path = "src/build_version_format.rs"]
mod build_version_format;

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() -> anyhow::Result<()> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let crate_dir = PathBuf::from(&manifest_dir);
    let workspace_root = crate_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("crate dir has no two-parent path"))?
        .to_path_buf();

    emit_build_version(&crate_dir)?;
    emit_ui_rerun_hints(&workspace_root);
    emit_git_rerun_hints(&crate_dir)?;
    build_ui(&workspace_root)?;

    Ok(())
}

fn emit_build_version(manifest_dir: &Path) -> anyhow::Result<()> {
    let commit_date = git_stdout(
        manifest_dir,
        &["show", "-s", "--date=format:%Y%m%d", "--format=%cd", "HEAD"],
    )?;
    let commit_hash = git_stdout(manifest_dir, &["rev-parse", "--short=7", "HEAD"])?;

    if commit_date.is_empty() {
        anyhow::bail!("git show --format=%cd HEAD returned an empty commit date");
    }
    if commit_hash.is_empty() {
        anyhow::bail!("git rev-parse --short=7 HEAD returned an empty commit hash");
    }

    let build_version = build_version_format::format_build_version(&commit_date, &commit_hash);
    println!("cargo:rustc-env=CKNERV_BUILD_VERSION={build_version}");

    Ok(())
}

/// Every input the pnpm build reads has to be a rerun trigger, because the
/// bundle `RustEmbed` freezes into the binary is whatever `dist/` happened to
/// hold when the derive expanded. `ui-app` consumes `@cknerv/{ui,cache,types}`
/// straight from their sources through the pnpm workspace link, so an edit
/// under `packages/*/src` changes the bundle without touching anything cargo
/// was watching: the crate stays "fresh", pnpm never runs, and the binary
/// re-embeds the previous `dist/` with nothing in the build log to say so. A
/// deleted font keeps shipping; a fixed component keeps its bug.
///
/// `rerun-if-changed` on a directory watches it recursively, which is how the
/// existing `ui-app/src` hint already works.
fn emit_ui_rerun_hints(workspace_root: &Path) {
    let ui_app = workspace_root.join("ui-app");
    let packages = workspace_root.join("packages");

    let watched = [
        ui_app.join("src"),
        ui_app.join("package.json"),
        ui_app.join("vite.config.ts"),
        ui_app.join("index.html"),
        packages.join("ui").join("src"),
        packages.join("ui").join("package.json"),
        packages.join("cache").join("src"),
        packages.join("cache").join("package.json"),
        packages.join("types").join("src"),
        packages.join("types").join("package.json"),
        // A re-resolved dependency graph changes the bundle without a single
        // source file moving.
        workspace_root.join("pnpm-lock.yaml"),
    ];

    for path in watched {
        println!("cargo:rerun-if-changed={}", path.display());
    }
}

fn emit_git_rerun_hints(manifest_dir: &Path) -> anyhow::Result<()> {
    let head_path = resolve_git_path(
        manifest_dir,
        &git_stdout(manifest_dir, &["rev-parse", "--git-path", "HEAD"])?,
    );
    println!("cargo:rerun-if-changed={}", head_path.display());

    let packed_refs_path = resolve_git_path(
        manifest_dir,
        &git_stdout(manifest_dir, &["rev-parse", "--git-path", "packed-refs"])?,
    );
    println!("cargo:rerun-if-changed={}", packed_refs_path.display());

    if let Some(current_ref) = try_git_stdout(manifest_dir, &["symbolic-ref", "-q", "HEAD"])? {
        let ref_path = resolve_git_path(
            manifest_dir,
            &git_stdout(manifest_dir, &["rev-parse", "--git-path", &current_ref])?,
        );
        println!("cargo:rerun-if-changed={}", ref_path.display());
    }

    Ok(())
}

fn resolve_git_path(manifest_dir: &Path, git_path: &str) -> PathBuf {
    let path = PathBuf::from(git_path);
    if path.is_absolute() {
        path
    } else {
        manifest_dir.join(path)
    }
}

/// `CKNERV_SKIP_UI_BUILD=1` is an opt-OUT for `cargo check` / clippy /
/// rust-analyzer cycles, where the full pnpm build is pure latency — the wider
/// rerun hints above mean any TS edit now triggers it. Unset (the release path)
/// behaves exactly as before: pnpm runs on every rerun.
///
/// Two guards keep the shortcut from becoming the stale-embed bug it sits next
/// to: it refuses to skip unless a `dist/` is already on disk to embed, and it
/// says so on stderr every time it fires, so a binary built this way is never
/// quiet about it.
fn build_ui(workspace_root: &Path) -> anyhow::Result<()> {
    println!("cargo:rerun-if-env-changed=CKNERV_SKIP_UI_BUILD");

    let dist_index = workspace_root
        .join("ui-app")
        .join("dist")
        .join("index.html");
    if env::var("CKNERV_SKIP_UI_BUILD").as_deref() == Ok("1") && dist_index.is_file() {
        println!(
            "cargo:warning=CKNERV_SKIP_UI_BUILD=1 — embedding the existing ui-app/dist \
             without rebuilding it; unset it before producing a release binary"
        );
        return Ok(());
    }

    let status = Command::new("pnpm")
        .args(["-F", "cknerv-ui-app", "build"])
        .current_dir(workspace_root)
        .status()?;
    if !status.success() {
        anyhow::bail!("ui-app build failed; see pnpm output above");
    }
    Ok(())
}

fn git_stdout(manifest_dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    try_git_stdout(manifest_dir, args)?.ok_or_else(|| {
        anyhow::anyhow!(
            "failed to run `git {}` while building cknerv version metadata",
            args.join(" ")
        )
    })
}

fn try_git_stdout(manifest_dir: &Path, args: &[&str]) -> anyhow::Result<Option<String>> {
    let output = Command::new("git")
        .args(args)
        .current_dir(manifest_dir)
        .output()?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8(output.stdout)?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}
