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

#[derive(RustEmbed)]
#[folder = "../../ui-app/dist/"]
struct Assets;

pub const BUILD_VERSION: &str = env!("CKNERV_BUILD_VERSION");

pub fn runtime_config_body(build_version: &str) -> String {
    let build_version = serde_json::to_string(build_version)
        .expect("failed to serialize cknerv build version for runtime config");
    format!(
        r#"(() => {{
  window.__CKNERV_RUNTIME_CONFIG__ = {{
    buildVersion: {build_version},
  }};
}})();
"#
    )
}

pub fn runtime_config_response(build_version: &str) -> Response {
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        runtime_config_body(build_version),
    )
        .into_response()
}

pub async fn serve_runtime_config() -> Response {
    runtime_config_response(BUILD_VERSION)
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
                .body(Body::from(content.data.into_owned()))
                .expect("response build")
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{runtime_config_body, runtime_config_response};
    use axum::http::header;

    #[test]
    fn runtime_config_body_assigns_build_version() {
        let body = runtime_config_body("0.1.0+feature/foo@abcdef123456");

        assert!(body.contains("window.__CKNERV_RUNTIME_CONFIG__"));
        assert!(body.contains("buildVersion: \"0.1.0+feature/foo@abcdef123456\""));
    }

    #[test]
    fn runtime_config_body_json_escapes_build_version() {
        let body = runtime_config_body("0.1.0+quote\"branch@abcdef123456");

        assert!(body.contains("buildVersion: \"0.1.0+quote\\\"branch@abcdef123456\""));
    }

    #[test]
    fn runtime_config_response_sets_javascript_headers() {
        let response = runtime_config_response("0.1.0@abcdef123456");

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
}
