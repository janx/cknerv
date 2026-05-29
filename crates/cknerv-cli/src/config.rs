//! `cknerv.toml` config: file parse + CLI/file/default merge.
//!
//! Priority: CLI args > cknerv.toml > built-in defaults. No env vars.

use std::path::Path;

use url::Url;

/// On-disk config shape. All-optional: a missing key falls through to the
/// CLI override (if any) then the built-in default.
#[derive(Debug, Default, serde::Deserialize)]
pub struct FileConfig {
    #[serde(default)]
    pub ckb: CkbSection,
    #[serde(default)]
    pub dashboard: DashboardSection,
    #[serde(default)]
    pub backfill: BackfillSection,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct CkbSection {
    pub rpc_url: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct DashboardSection {
    pub port: Option<u16>,
    pub open: Option<bool>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct BackfillSection {
    pub blocks: Option<u64>,
}

/// Fully-resolved runtime config after merging CLI > file > defaults.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub rpc_url: Url,
    pub port: u16,
    pub open: bool,
    pub backfill_blocks: u64,
}

const DEFAULT_RPC: &str = "http://localhost:8114";
const DEFAULT_PORT: u16 = 7001;
const DEFAULT_BACKFILL: u64 = 1000;

/// Load `<workdir>/cknerv.toml`. Absent file → empty (all-default) config.
/// Present but unparseable → error.
pub fn load(workdir: &Path) -> anyhow::Result<FileConfig> {
    let path = workdir.join("cknerv.toml");
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            toml::from_str(&s).map_err(|e| anyhow::anyhow!("parse {}: {e}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileConfig::default()),
        Err(e) => Err(anyhow::anyhow!("read {}: {e}", path.display())),
    }
}

/// Merge CLI overrides over the file config over built-in defaults.
/// `cli_no_open` is the bare `--no-open` flag: true forces `open=false`;
/// false defers to the file's `open` (or the default `true`).
pub fn resolve(
    cli_rpc: Option<Url>,
    cli_port: Option<u16>,
    cli_no_open: bool,
    cli_backfill: Option<u64>,
    file: &FileConfig,
) -> anyhow::Result<ResolvedConfig> {
    let rpc_url = match cli_rpc {
        Some(u) => u,
        None => match file.ckb.rpc_url.as_deref() {
            Some(s) => Url::parse(s)
                .map_err(|e| anyhow::anyhow!("cknerv.toml [ckb] rpc_url {s:?}: {e}"))?,
            None => Url::parse(DEFAULT_RPC).expect("static URL"),
        },
    };
    let port = cli_port.or(file.dashboard.port).unwrap_or(DEFAULT_PORT);
    let open = if cli_no_open {
        false
    } else {
        file.dashboard.open.unwrap_or(true)
    };
    let backfill_blocks = cli_backfill
        .or(file.backfill.blocks)
        .unwrap_or(DEFAULT_BACKFILL);
    Ok(ResolvedConfig {
        rpc_url,
        port,
        open,
        backfill_blocks,
    })
}

/// Commented template written by `cknerv init`. Keep in sync with [`FileConfig`].
pub const CKNERV_TOML_TEMPLATE: &str = r#"# cknerv configuration. Priority: CLI args > this file > built-in defaults.

[ckb]
# CKB JSON-RPC endpoint.
rpc_url = "http://localhost:8114"

[dashboard]
# HTTP/WS port for the dashboard SPA.
port = 7001
# Auto-open the browser on start (--no-open overrides).
open = true

[backfill]
# Recent blocks to replay at boot to seed the live-cell galaxy. 0 disables.
blocks = 1000
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("cknerv-cfg-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn defaults_when_no_file_and_no_cli() {
        let dir = tmpdir();
        let file = load(&dir).unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();
        assert_eq!(r.rpc_url.as_str(), "http://localhost:8114/");
        assert_eq!(r.port, 7001);
        assert!(r.open);
        assert_eq!(r.backfill_blocks, 1000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_overrides_defaults_then_cli_overrides_file() {
        let dir = tmpdir();
        std::fs::write(
            dir.join("cknerv.toml"),
            "[ckb]\nrpc_url = \"http://node:9999\"\n[dashboard]\nport = 8080\nopen = false\n[backfill]\nblocks = 50\n",
        )
        .unwrap();
        let file = load(&dir).unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();
        assert_eq!(r.rpc_url.as_str(), "http://node:9999/");
        assert_eq!(r.port, 8080);
        assert!(!r.open);
        assert_eq!(r.backfill_blocks, 50);

        let cli_rpc = Url::parse("http://cli:1111").unwrap();
        let r2 = resolve(Some(cli_rpc), Some(1234), false, Some(7), &file).unwrap();
        assert_eq!(r2.rpc_url.as_str(), "http://cli:1111/");
        assert_eq!(r2.port, 1234);
        assert_eq!(r2.backfill_blocks, 7);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_open_flag_forces_false_over_file_default_true() {
        let file = FileConfig::default();
        let r = resolve(None, None, true, None, &file).unwrap();
        assert!(!r.open);
    }

    #[test]
    fn template_parses_to_documented_defaults() {
        let file: FileConfig = toml::from_str(CKNERV_TOML_TEMPLATE).unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();
        assert_eq!(r.rpc_url.as_str(), "http://localhost:8114/");
        assert_eq!(r.port, 7001);
        assert!(r.open);
        assert_eq!(r.backfill_blocks, 1000);
    }

    #[test]
    fn bad_toml_errors() {
        let dir = tmpdir();
        std::fs::write(dir.join("cknerv.toml"), "this is = = not valid").unwrap();
        assert!(load(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
