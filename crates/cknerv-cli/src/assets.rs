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
