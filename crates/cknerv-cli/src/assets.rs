//! Embed `ui-app/dist` into the binary via rust-embed and serve it as
//! the axum fallback so any request that misses `cknerv-server`'s API
//! routes falls through to the SPA.
//!
//! The folder path is relative to the crate's `Cargo.toml`; `build.rs`
//! invokes the ui-app pnpm build before each compile so `dist/` is
//! always populated before `RustEmbed` macro-expands.
//!
//! SPA fallback policy: any URI path without an extension serves
//! `index.html` (so future React Router routes resolve client-side
//! without 404s). Paths with extensions hit the embedded bundle
//! directly; missing assets return 404.

use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

use crate::config::ResolvedGalaxyConfig;

#[derive(RustEmbed)]
#[folder = "../../ui-app/dist/"]
// Vite is configured with `sourcemap: false`, so this excludes nothing today.
// It stays as a standing guarantee: flipping sourcemaps on for a local debug
// session must never quietly add megabytes of `.map` to the shipped binary.
#[exclude = "*.map"]
struct Assets;

pub const BUILD_VERSION: &str = env!("CKNERV_BUILD_VERSION");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfigPayload<'a> {
    build_version: &'a str,
    galaxy: &'a ResolvedGalaxyConfig,
    enrichment: RuntimeEnrichmentPayload<'a>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEnrichmentPayload<'a> {
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'a str>,
}

pub fn runtime_config_body(
    build_version: &str,
    galaxy: &ResolvedGalaxyConfig,
    enrichment_source: Option<&str>,
) -> String {
    let payload = serde_json::to_string(&RuntimeConfigPayload {
        build_version,
        galaxy,
        enrichment: RuntimeEnrichmentPayload {
            enabled: enrichment_source.is_some(),
            source: enrichment_source,
        },
    })
    .expect("failed to serialize cknerv runtime config");
    format!(
        r#"(() => {{
  window.__CKNERV_RUNTIME_CONFIG__ = {payload};
}})();
"#
    )
}

pub fn runtime_config_response(
    build_version: &str,
    galaxy: ResolvedGalaxyConfig,
    enrichment_source: Option<&str>,
) -> Response {
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        runtime_config_body(build_version, &galaxy, enrichment_source),
    )
        .into_response()
}

/// Cache policy for an embedded path, already stripped of its leading `/`.
///
/// Everything Vite emits under `assets/` carries a content hash in its
/// filename, so the URL changes whenever the bytes do — the response can be
/// frozen for a year and a redeploy can never be served a stale one.
/// `index.html` is the opposite: its name is fixed and its body names those
/// hashed URLs, so a cached copy pins the browser to a bundle the new binary
/// no longer embeds. It must revalidate on every load, as must the SPA
/// fallback, which is the same document under another path. Any other name in
/// `dist/` is unhashed by definition and gets the same conservative default.
fn cache_control_for(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

pub async fn serve_spa(uri: Uri) -> Response {
    let raw_path = uri.path().trim_start_matches('/');
    // SPA fallback — extension-less paths serve index.html so client-side
    // routing works without server-side route awareness.
    let path = if raw_path.is_empty() || !raw_path.contains('.') {
        "index.html"
    } else {
        raw_path
    };
    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, cache_control_for(path))
                .body(Body::from(content.data.into_owned()))
                .expect("response build")
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cache_control_for, runtime_config_body, runtime_config_response, serve_spa, Assets,
    };
    use axum::http::{header, StatusCode, Uri};
    use axum::response::Response;

    const IMMUTABLE: &str = "public, max-age=31536000, immutable";

    fn header_str<'a>(response: &'a Response, name: header::HeaderName) -> &'a str {
        response
            .headers()
            .get(name)
            .expect("header present")
            .to_str()
            .expect("header is valid ascii")
    }

    #[test]
    fn runtime_config_body_assigns_build_version() {
        let body = runtime_config_body(
            "61922ba@20260630",
            &crate::config::ResolvedGalaxyConfig::for_profile(crate::config::GalaxyProfile::Devnet),
            Some("ckbadger"),
        );

        assert!(body.contains("window.__CKNERV_RUNTIME_CONFIG__"));
        assert!(body.contains("\"buildVersion\":\"61922ba@20260630\""));
        assert!(body.contains("\"profile\":\"devnet\""));
        assert!(body.contains("\"neighborK\":5"));
        assert!(body.contains("\"enrichment\":{\"enabled\":true,\"source\":\"ckbadger\"}"));
    }

    #[test]
    fn runtime_config_body_json_escapes_build_version() {
        let body = runtime_config_body(
            "61\"922ba@20260630",
            &crate::config::ResolvedGalaxyConfig::for_profile(crate::config::GalaxyProfile::Auto),
            None,
        );

        assert!(body.contains("\"buildVersion\":\"61\\\"922ba@20260630\""));
    }

    #[test]
    fn runtime_config_response_sets_javascript_headers() {
        let response = runtime_config_response(
            "61922ba@20260630",
            crate::config::ResolvedGalaxyConfig::for_profile(crate::config::GalaxyProfile::Auto),
            None,
        );

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/javascript; charset=utf-8"
        );
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .unwrap()
                .to_str()
                .unwrap(),
            "no-cache"
        );
    }

    #[test]
    fn only_hashed_asset_paths_earn_the_immutable_year() {
        assert_eq!(cache_control_for("assets/index-zfBVfAzR.js"), IMMUTABLE);
        assert_eq!(
            cache_control_for("assets/Saira-latin-C4OLzBX3.woff2"),
            IMMUTABLE
        );
        assert_eq!(cache_control_for("index.html"), "no-cache");
        // Unhashed names at the dist root — a favicon, a manifest, anything a
        // future Vite config drops in `publicDir` — must not inherit the year.
        assert_eq!(cache_control_for("favicon.ico"), "no-cache");
        assert_eq!(cache_control_for("manifest.webmanifest"), "no-cache");
    }

    #[test]
    fn the_embedded_bundle_carries_no_sourcemaps() {
        let maps: Vec<_> = Assets::iter().filter(|p| p.ends_with(".map")).collect();
        assert!(
            maps.is_empty(),
            "sourcemaps leaked into the binary: {maps:?}"
        );
    }

    #[tokio::test]
    async fn spa_fallback_serves_a_revalidating_index_html() {
        // Extension-less path — a client-side route, not a file.
        let response = serve_spa(Uri::from_static("/cell/0x1234")).await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(header_str(&response, header::CACHE_CONTROL), "no-cache");
        assert!(header_str(&response, header::CONTENT_TYPE).starts_with("text/html"));
    }

    #[tokio::test]
    async fn a_hashed_asset_is_served_immutable() {
        let hashed = Assets::iter()
            .find(|path| path.starts_with("assets/"))
            .expect("ui-app/dist must embed at least one hashed asset");
        let uri: Uri = format!("/{hashed}")
            .parse()
            .expect("asset path is a valid uri");

        let response = serve_spa(uri).await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(header_str(&response, header::CACHE_CONTROL), IMMUTABLE);
    }

    #[tokio::test]
    async fn a_missing_asset_still_404s() {
        let response = serve_spa(Uri::from_static("/assets/never-emitted-DEADBEEF.js")).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
