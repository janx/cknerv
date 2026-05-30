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
    let semver = env::var("CARGO_PKG_VERSION")?;
    let branch_name = try_git_stdout(manifest_dir, &["branch", "--show-current"])?;
    let commit_hash = git_stdout(manifest_dir, &["rev-parse", "--short=12", "HEAD"])?;

    if commit_hash.is_empty() {
        anyhow::bail!("git rev-parse --short=12 HEAD returned an empty commit hash");
    }

    let build_version =
        build_version_format::format_build_version(&semver, branch_name.as_deref(), &commit_hash);
    println!("cargo:rustc-env=CKNERV_BUILD_VERSION={build_version}");

    Ok(())
}

fn emit_ui_rerun_hints(workspace_root: &Path) {
    let ui_app = workspace_root.join("ui-app");

    println!("cargo:rerun-if-changed={}", ui_app.join("src").display());
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

fn build_ui(workspace_root: &Path) -> anyhow::Result<()> {
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
