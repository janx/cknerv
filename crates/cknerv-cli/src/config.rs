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
    pub ckbadger: Option<CkbadgerSection>,
    #[serde(default)]
    pub dashboard: DashboardSection,
    #[serde(default)]
    pub galaxy: GalaxySection,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct CkbadgerSection {
    pub api_url: Option<String>,
    pub max_lag_blocks: Option<u64>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GalaxyProfile {
    Auto,
    Devnet,
    Testnet,
    Mainnet,
    Custom,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct GalaxySection {
    pub profile: Option<GalaxyProfile>,
    pub recent_links_cap: Option<usize>,
    #[serde(default)]
    pub topology: GalaxyTopologySection,
    #[serde(default)]
    pub pulses: GalaxyPulsesSection,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct GalaxyTopologySection {
    pub neighbor_k: Option<usize>,
    pub max_edge_length: Option<f32>,
    pub max_hops: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub struct GalaxyPulsesSection {
    pub link_ring_capacity: Option<usize>,
    pub max_pulses_per_link: Option<usize>,
    pub max_origins_per_link: Option<usize>,
    pub max_active_pulses: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedGalaxyConfig {
    pub profile: GalaxyProfile,
    /// NOT a knob: always `cknerv_core::projection::cells::CELL_CAP`. Kept
    /// in the resolved struct so the runtime-config payload keeps telling
    /// the SPA the reservoir bound, and because hydration/persistence/
    /// composition all read it from here. A legacy `cell_cap` line in an
    /// existing cknerv.toml is silently ignored (serde tolerates unknown
    /// keys); a workdir hydrated to a smaller historical target simply
    /// rehydrates once.
    pub cell_cap: usize,
    pub recent_links_cap: usize,
    pub topology: ResolvedGalaxyTopologyConfig,
    pub pulses: ResolvedGalaxyPulsesConfig,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedGalaxyTopologyConfig {
    pub neighbor_k: usize,
    pub max_edge_length: f32,
    pub max_hops: usize,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedGalaxyPulsesConfig {
    pub link_ring_capacity: usize,
    pub max_pulses_per_link: usize,
    pub max_origins_per_link: usize,
    pub max_active_pulses: usize,
}

/// Fully-resolved runtime config after merging CLI > file > defaults.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub rpc_url: Url,
    pub port: u16,
    pub open: bool,
    /// Optional one-run hard limit for Cell hydration. `None` uses the
    /// target-driven policy (the built-in live-cell reservoir target).
    pub backfill_blocks: Option<u64>,
    /// Optional local indexed context. Section absence keeps enrichment off.
    pub ckbadger: Option<ResolvedCkbadgerConfig>,
    pub galaxy: ResolvedGalaxyConfig,
}

#[derive(Debug, Clone)]
pub struct ResolvedCkbadgerConfig {
    pub api_url: Url,
    pub max_lag_blocks: u64,
}

const DEFAULT_RPC: &str = "http://localhost:8114";
const DEFAULT_PORT: u16 = 7001;

impl ResolvedGalaxyConfig {
    /// Every profile serves ONE value set: the SPA's bundled defaults
    /// (`ui-app/src/runtime-config.ts` DEFAULT_GALAXY_CONFIG). This payload
    /// overrides those defaults in every embedded deployment while the Vite
    /// dev harness runs them directly, so any per-profile number here that
    /// trails a frontend retune ships a galaxy nobody ever visually
    /// accepted — which is exactly what happened twice (the gap-fill
    /// densification and the link-ring block guarantee both reached only
    /// dev). The shared fixture test below pins the two sides together;
    /// reintroduce a per-profile delta only as a deliberate divergence with
    /// its own fixture.
    pub fn for_profile(profile: GalaxyProfile) -> Self {
        Self {
            profile,
            cell_cap: cknerv_core::projection::cells::CELL_CAP,
            recent_links_cap: 2048,
            topology: ResolvedGalaxyTopologyConfig {
                neighbor_k: 5,
                max_edge_length: 42.0,
                // Reach, in hops, for a router that weighs every edge the
                // same. The fabric's k-NN search was corrected to return the
                // true nearest neighbours, which shortened its median edge
                // ~2.9x, so 40 hops now buy a third of the world distance
                // they were tuned for. Measured over random source/target
                // pairs on the corrected graph, 80 is the first budget that
                // still completes every pair at 12,000 AND 50,000 Cells
                // (40 -> 96.4%/70.0%, 60 -> 100%/99.3%).
                max_hops: 80,
            },
            pulses: ResolvedGalaxyPulsesConfig {
                // Sized for the block guarantee: the ring must hold a whole
                // busy block's links until the plan effect consumes them.
                link_ring_capacity: 512,
                max_pulses_per_link: 6,
                max_origins_per_link: 2,
                max_active_pulses: 256,
            },
        }
    }
}

/// Load `<workdir>/cknerv.toml`. Absent file → empty (all-default) config.
/// Present but unparseable → error.
pub fn load(workdir: &Path) -> anyhow::Result<FileConfig> {
    let path = workdir.join("cknerv.toml");
    match std::fs::read_to_string(&path) {
        Ok(s) => toml::from_str(&s).map_err(|e| anyhow::anyhow!("parse {}: {e}", path.display())),
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
    let profile = file.galaxy.profile.unwrap_or(GalaxyProfile::Auto);
    // Historical hydration is target-driven by the built-in reservoir
    // target. The CLI
    // value is deliberately not defaulted: when present it is a one-run hard
    // block-window override for diagnostics.
    let backfill_blocks = cli_backfill;
    let ckbadger = file
        .ckbadger
        .as_ref()
        .map(|section| {
            let raw = section
                .api_url
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("cknerv.toml [ckbadger] requires api_url"))?;
            let api_url = Url::parse(raw)
                .map_err(|e| anyhow::anyhow!("cknerv.toml [ckbadger] api_url {raw:?}: {e}"))?;
            if !matches!(api_url.scheme(), "http" | "https") {
                return Err(anyhow::anyhow!(
                    "cknerv.toml [ckbadger] api_url must use http or https"
                ));
            }
            Ok(ResolvedCkbadgerConfig {
                api_url,
                max_lag_blocks: section.max_lag_blocks.unwrap_or(12),
            })
        })
        .transpose()?;
    let mut galaxy = ResolvedGalaxyConfig::for_profile(profile);
    if let Some(v) = file.galaxy.recent_links_cap {
        galaxy.recent_links_cap = v;
    }
    if let Some(v) = file.galaxy.topology.neighbor_k {
        galaxy.topology.neighbor_k = v;
    }
    if let Some(v) = file.galaxy.topology.max_edge_length {
        galaxy.topology.max_edge_length = v;
    }
    if let Some(v) = file.galaxy.topology.max_hops {
        galaxy.topology.max_hops = v;
    }
    if let Some(v) = file.galaxy.pulses.link_ring_capacity {
        galaxy.pulses.link_ring_capacity = v;
    }
    if let Some(v) = file.galaxy.pulses.max_pulses_per_link {
        galaxy.pulses.max_pulses_per_link = v;
    }
    if let Some(v) = file.galaxy.pulses.max_origins_per_link {
        galaxy.pulses.max_origins_per_link = v;
    }
    if let Some(v) = file.galaxy.pulses.max_active_pulses {
        galaxy.pulses.max_active_pulses = v;
    }
    Ok(ResolvedConfig {
        rpc_url,
        port,
        open,
        backfill_blocks,
        ckbadger,
        galaxy,
    })
}

/// Commented template written by `cknerv init`. Keep in sync with [`FileConfig`].
pub const CKNERV_TOML_TEMPLATE: &str = r#"# cknerv configuration. Priority: CLI args > this file > built-in defaults.

[ckb]
# CKB JSON-RPC endpoint.
rpc_url = "http://localhost:8114"

# Optional indexed semantics and CellGalaxy composition. Uncomment the three
# configuration lines below to enable ckbadger. See docs/ckbadger.md.
# Direct API example:       http://127.0.0.1:8101/api/v1
# Orchestrator API example: http://127.0.0.1:8100/api/mainnet/v1
# [ckbadger]
# api_url = "http://127.0.0.1:8101/api/v1"
# max_lag_blocks = 12

[dashboard]
# HTTP/WS port for the dashboard SPA.
port = 7001
# Auto-open the browser on start (--no-open overrides).
open = true

[galaxy]
# auto uses balanced defaults. Explicit: devnet, testnet, mainnet, custom.
profile = "auto"
# Recent tx-link records retained in server snapshots.
recent_links_cap = 2048

[galaxy.topology]
# Spatial neighbour graph density and pulse route reach.
neighbor_k = 5
max_edge_length = 42.0
max_hops = 80

[galaxy.pulses]
# Frontend pulse retention and visual fan-out limits. link_ring_capacity
# below the SPA default (512) re-opens silent whole-block-dark eviction.
link_ring_capacity = 512
max_pulses_per_link = 6
max_origins_per_link = 2
max_active_pulses = 256
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
        assert_eq!(r.backfill_blocks, None);
        assert!(r.ckbadger.is_none());
        assert_eq!(r.galaxy.cell_cap, 50_000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ckbadger_section_is_optional_and_validated() {
        let file: FileConfig = toml::from_str(
            "[ckbadger]\napi_url = \"http://127.0.0.1:8101/api/v1\"\nmax_lag_blocks = 24\n",
        )
        .unwrap();
        let resolved = resolve(None, None, false, None, &file).unwrap();
        let ckbadger = resolved.ckbadger.expect("configured ckbadger");

        assert_eq!(ckbadger.api_url.as_str(), "http://127.0.0.1:8101/api/v1");
        assert_eq!(ckbadger.max_lag_blocks, 24);

        let missing_url: FileConfig = toml::from_str("[ckbadger]\nmax_lag_blocks = 2\n").unwrap();
        assert!(resolve(None, None, false, None, &missing_url).is_err());
    }

    #[test]
    fn file_overrides_defaults_then_cli_overrides_automatic_replay() {
        let dir = tmpdir();
        std::fs::write(
            dir.join("cknerv.toml"),
            "[ckb]\nrpc_url = \"http://node:9999\"\n[dashboard]\nport = 8080\nopen = false\n",
        )
        .unwrap();
        let file = load(&dir).unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();
        assert_eq!(r.rpc_url.as_str(), "http://node:9999/");
        assert_eq!(r.port, 8080);
        assert!(!r.open);
        assert_eq!(r.backfill_blocks, None);

        let cli_rpc = Url::parse("http://cli:1111").unwrap();
        let r2 = resolve(Some(cli_rpc), Some(1234), false, Some(7), &file).unwrap();
        assert_eq!(r2.rpc_url.as_str(), "http://cli:1111/");
        assert_eq!(r2.port, 1234);
        assert_eq!(r2.backfill_blocks, Some(7));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_toml_backfill_is_ignored_in_favor_of_target_policy() {
        let file: FileConfig =
            toml::from_str("[backfill]\nblocks = 77\n[galaxy]\nprofile = \"devnet\"\n").unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();

        assert_eq!(r.backfill_blocks, None);
    }

    #[test]
    fn every_profile_serves_the_same_galaxy_values() {
        // Profile-specific numbers went stale against frontend retunes twice
        // and silently overrode them in production. Until a divergence is
        // chosen deliberately (with its own fixture), the profiles converge.
        let auto = ResolvedGalaxyConfig::for_profile(GalaxyProfile::Auto);
        for profile in [
            GalaxyProfile::Devnet,
            GalaxyProfile::Testnet,
            GalaxyProfile::Mainnet,
            GalaxyProfile::Custom,
        ] {
            let mut resolved = ResolvedGalaxyConfig::for_profile(profile);
            assert_eq!(resolved.profile, profile);
            resolved.profile = GalaxyProfile::Auto;
            assert_eq!(
                resolved, auto,
                "{profile:?} diverged from the shared galaxy values"
            );
        }
    }

    #[test]
    fn galaxy_payload_matches_the_shared_fixture() {
        // Cross-language gate: the embedded server injects this struct as
        // `window.__CKNERV_RUNTIME_CONFIG__.galaxy`, overriding the SPA's
        // bundled defaults. ui-app's runtime-config test reads the SAME
        // fixture and asserts it resolves to DEFAULT_GALAXY_CONFIG, so a
        // retune that lands on only one side fails one of the two tests.
        // Regenerate with `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-cli`.
        let auto = ResolvedGalaxyConfig::for_profile(GalaxyProfile::Auto);
        let mut encoded = serde_json::to_string_pretty(&auto).expect("serialize galaxy config");
        encoded.push('\n');
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/runtime_config_galaxy.json"
        );
        if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
            std::fs::write(path, &encoded).expect("write fixture");
        }
        let fixture = std::fs::read_to_string(path).expect("read fixture");
        assert_eq!(
            encoded, fixture,
            "runtime galaxy config drifted from the shared fixture; regenerate \
             with CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-cli, then re-run \
             the ui-app runtime-config test to confirm the SPA defaults agree"
        );
    }

    #[test]
    fn explicit_galaxy_values_override_profile_defaults() {
        let file: FileConfig = toml::from_str(
            "[galaxy]\nprofile = \"mainnet\"\ncell_cap = 3333\nrecent_links_cap = 444\n\
             [galaxy.topology]\nneighbor_k = 6\nmax_edge_length = 31.5\nmax_hops = 44\n\
             [galaxy.pulses]\nlink_ring_capacity = 88\nmax_pulses_per_link = 9\nmax_origins_per_link = 3\nmax_active_pulses = 111\n",
        )
        .unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();

        assert_eq!(r.backfill_blocks, None);
        assert_eq!(r.galaxy.profile, GalaxyProfile::Mainnet);
        // A legacy `cell_cap` line is tolerated and ignored — the reservoir
        // bound is not a knob.
        assert_eq!(r.galaxy.cell_cap, 50_000);
        assert_eq!(r.galaxy.recent_links_cap, 444);
        assert_eq!(r.galaxy.topology.neighbor_k, 6);
        assert_eq!(r.galaxy.topology.max_edge_length, 31.5);
        assert_eq!(r.galaxy.topology.max_hops, 44);
        assert_eq!(r.galaxy.pulses.link_ring_capacity, 88);
        assert_eq!(r.galaxy.pulses.max_pulses_per_link, 9);
        assert_eq!(r.galaxy.pulses.max_origins_per_link, 3);
        assert_eq!(r.galaxy.pulses.max_active_pulses, 111);
    }

    #[test]
    fn no_open_flag_forces_false_over_file_default_true() {
        let file = FileConfig::default();
        let r = resolve(None, None, true, None, &file).unwrap();
        assert!(!r.open);
    }

    #[test]
    fn template_parses_to_documented_defaults() {
        assert!(!CKNERV_TOML_TEMPLATE.contains("[backfill]"));
        assert!(CKNERV_TOML_TEMPLATE.contains(
            "# [ckbadger]\n# api_url = \"http://127.0.0.1:8101/api/v1\"\n# max_lag_blocks = 12"
        ));
        let file: FileConfig = toml::from_str(CKNERV_TOML_TEMPLATE).unwrap();
        let r = resolve(None, None, false, None, &file).unwrap();
        assert_eq!(r.rpc_url.as_str(), "http://localhost:8114/");
        assert_eq!(r.port, 7001);
        assert!(r.open);
        assert_eq!(r.backfill_blocks, None);
        assert!(r.ckbadger.is_none());
        assert_eq!(r.galaxy.cell_cap, 50_000);
        // The documented values must BE the built-in defaults, or an
        // uncommented template line silently pins a stale number.
        assert_eq!(
            r.galaxy,
            ResolvedGalaxyConfig::for_profile(GalaxyProfile::Auto)
        );
    }

    #[test]
    fn bad_toml_errors() {
        let dir = tmpdir();
        std::fs::write(dir.join("cknerv.toml"), "this is = = not valid").unwrap();
        assert!(load(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
