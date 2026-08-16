//! `init` and `purge` subcommand implementations. Pure filesystem ops
//! over a resolved work directory.

use std::path::Path;

use anyhow::{bail, Result};

use crate::config::CKNERV_TOML_TEMPLATE;

/// Scaffold the work directory: write `cknerv.toml` (if absent) + create
/// `data/`. Idempotent; never clobbers an existing config.
pub fn cmd_init(workdir: &Path) -> Result<()> {
    std::fs::create_dir_all(workdir)?;
    let config_path = workdir.join("cknerv.toml");
    if config_path.exists() {
        println!(
            "cknerv.toml already exists at {} — leaving it as-is.",
            config_path.display()
        );
    } else {
        std::fs::write(&config_path, CKNERV_TOML_TEMPLATE)?;
        println!("Created {}", config_path.display());
    }
    let data_dir = workdir.join("data");
    std::fs::create_dir_all(&data_dir)?;
    println!("Created {}/", data_dir.display());
    Ok(())
}

/// Delete derived data (`data/`), keep `cknerv.toml`. Requires the workdir
/// to be initialized and `--confirm`.
pub fn cmd_purge(workdir: &Path, confirm: bool) -> Result<()> {
    let config_path = workdir.join("cknerv.toml");
    if !config_path.exists() {
        bail!(
            "work directory not initialized (no cknerv.toml at {}). Run `cknerv init` first.",
            config_path.display()
        );
    }
    if !confirm {
        bail!("purge requires --confirm to proceed");
    }
    let data_dir = workdir.join("data");
    if data_dir.exists() {
        std::fs::remove_dir_all(&data_dir)
            .map_err(|e| anyhow::anyhow!("failed to remove {}: {e}", data_dir.display()))?;
        std::fs::create_dir_all(&data_dir)?;
        println!("Purged derived data: {}/", data_dir.display());
    } else {
        println!("Nothing to purge.");
    }
    println!("Preserved: {}", config_path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("cknerv-cmd-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn init_creates_config_and_data_and_does_not_clobber() {
        let dir = tmpdir();
        cmd_init(&dir).unwrap();
        assert!(dir.join("cknerv.toml").exists());
        assert!(dir.join("data").is_dir());
        let generated = std::fs::read_to_string(dir.join("cknerv.toml")).unwrap();
        assert!(generated.contains(
            "# [ckbadger]\n# api_url = \"http://127.0.0.1:8101/api/v1\"\n# max_lag_blocks = 12"
        ));

        std::fs::write(dir.join("cknerv.toml"), "rpc_url = \"keepme\"\n").unwrap();
        cmd_init(&dir).unwrap();
        let content = std::fs::read_to_string(dir.join("cknerv.toml")).unwrap();
        assert!(
            content.contains("keepme"),
            "existing config must not be clobbered"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn purge_bails_when_uninitialized() {
        let dir = tmpdir();
        assert!(cmd_purge(&dir, true).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn purge_requires_confirm() {
        let dir = tmpdir();
        cmd_init(&dir).unwrap();
        assert!(cmd_purge(&dir, false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn purge_deletes_data_keeps_config() {
        let dir = tmpdir();
        cmd_init(&dir).unwrap();
        let state = dir.join("data").join("cknerv-state.json");
        std::fs::write(&state, "{}").unwrap();
        cmd_purge(&dir, true).unwrap();
        assert!(!state.exists(), "data file removed");
        assert!(dir.join("data").is_dir(), "data dir recreated");
        assert!(dir.join("cknerv.toml").exists(), "config preserved");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
