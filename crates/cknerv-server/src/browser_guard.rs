//! The one thing binding loopback does not keep out: the operator's browser.
//!
//! `127.0.0.1:{port}` keeps the LAN away from this API, and it is why the API
//! has no authentication — the only thing that can reach it is the machine it
//! runs on. A browser sitting on that machine breaks the assumption twice
//! over:
//!
//!   * Any page the operator has open may open
//!     `ws://127.0.0.1:7001/api/entities/chain/stream` and read every frame.
//!     CORS does not apply to WebSockets, so nothing but this check stands
//!     between a foreign page and the node's `p2p_node_id`, its peer list
//!     with multiaddrs and versions, and the whole cell galaxy.
//!   * DNS rebinding does the same for the plain routes: a name the page
//!     controls resolves to 127.0.0.1 on its second lookup, and the requests
//!     that follow are same-origin as far as the browser is concerned. What
//!     the `Host` header still says is the name, not the address.
//!
//! So the guard reads the two headers a browser fills in honestly and refuses
//! anything that is not loopback. The rule is not configurable (there is
//! nothing to configure while the listener is loopback-only): `localhost`,
//! any `*.localhost` name, any address in `127.0.0.0/8`, and `::1`, on any
//! port and under any scheme.
//!
//! An ABSENT `Origin` is allowed. curl, a monitor, a test harness and the
//! `@cknerv/cache` reconnect tests are not browsers and send no origin, and
//! the header cannot be forged by the page this guard exists to stop — a
//! browser sets it itself. The Vite dev proxy is unaffected for the same
//! reason it works at all: `changeOrigin: true` rewrites `Host` to
//! `localhost:7001` and forwards `Origin: http://localhost:5173`, and both
//! sides of that are loopback.

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;

/// Whether a `Host`-style `<host>[:<port>]` names something on this machine.
pub(crate) fn authority_is_loopback(authority: &str) -> bool {
    let Some(host) = host_without_port(authority) else {
        return false;
    };

    // `localhost` and everything under it. The `.localhost` TLD is reserved
    // for exactly this by RFC 6761, and browsers resolve it to loopback
    // without asking a resolver, so a name that ends there cannot be pointed
    // anywhere else by the page that used it.
    const LOCALHOST_SUFFIX: &str = ".localhost";
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let bytes = host.as_bytes();
    if bytes.len() > LOCALHOST_SUFFIX.len() {
        let tail = &bytes[bytes.len() - LOCALHOST_SUFFIX.len()..];
        if tail.eq_ignore_ascii_case(LOCALHOST_SUFFIX.as_bytes()) {
            return true;
        }
    }

    // Address literals. Whole `127.0.0.0/8` rather than `127.0.0.1` alone,
    // because that is the block the kernel routes to the loopback interface
    // and a client is free to use any of it. Anything that is not a literal
    // is a name we have already decided is not ours: a resolver's answer is
    // not evidence, which is the entire DNS-rebinding hole.
    if let Ok(v4) = host.parse::<std::net::Ipv4Addr>() {
        return v4.is_loopback();
    }
    if let Ok(v6) = host.parse::<std::net::Ipv6Addr>() {
        return v6.is_loopback();
    }
    false
}

/// Whether an `Origin` header names a loopback page.
///
/// RFC 6454 serializes an origin as `<scheme>://<host>[:<port>]` and nothing
/// else — no path, no trailing slash — so anything that does not split on
/// `://` is refused rather than guessed at, and that includes the literal
/// `null` a sandboxed or `file:` document sends.
pub(crate) fn origin_is_loopback(origin: &str) -> bool {
    match origin.split_once("://") {
        Some((_scheme, authority)) => authority_is_loopback(authority),
        None => false,
    }
}

/// The host half of an authority, with the brackets taken off an IPv6
/// literal. `None` when the value cannot be read as an authority at all.
fn host_without_port(authority: &str) -> Option<&str> {
    if let Some(rest) = authority.strip_prefix('[') {
        // RFC 3986 brackets an IPv6 literal precisely so that the colons
        // inside it cannot be mistaken for the port separator.
        let (inside, after) = rest.split_once(']')?;
        let after_is_port = match after.strip_prefix(':') {
            Some(port) => !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()),
            None => after.is_empty(),
        };
        return after_is_port.then_some(inside);
    }
    match authority.rsplit_once(':') {
        // One trailing `:<digits>` is a port. More colons than that means an
        // unbracketed IPv6 literal, whose colons belong to the address —
        // `Ipv6Addr` gets the whole string and decides.
        Some((host, port))
            if !host.contains(':')
                && !port.is_empty()
                && port.bytes().all(|b| b.is_ascii_digit()) =>
        {
            Some(host)
        }
        _ => Some(authority),
    }
}

/// Refuse a request a browser sent from somewhere other than this machine.
///
/// Applied in [`crate::routes::build_router`], so it covers `/api/*` and
/// nothing else: the SPA bytes and `/runtime-config.js` the CLI adds
/// afterwards are public files with no reader's data in them.
pub(crate) async fn loopback_only(req: Request, next: Next) -> Response {
    let headers = req.headers();

    // Origin first, because it is the header that describes the PAGE. A
    // request that carries one and is not from here is refused whatever its
    // Host says.
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin.to_str().is_ok_and(origin_is_loopback) {
            return refused(
                "forbidden_origin",
                "this API answers only pages served from loopback",
            );
        }
    }

    // Host second, for the rebinding case: no origin is sent on a top-level
    // navigation or a simple GET, and the name in the request is the only
    // place the deception shows.
    if let Some(host) = headers.get(header::HOST) {
        if !host.to_str().is_ok_and(authority_is_loopback) {
            return refused(
                "forbidden_host",
                "this API answers only requests addressed to loopback",
            );
        }
    }

    next.run(req).await
}

fn refused(error: &'static str, message: &'static str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({ "error": error, "message": message })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both columns of the rule, stated as the values that actually arrive:
    /// what the CLI's own dashboard sends, what the dev proxy sends, and the
    /// shapes a hostile page would have to produce to get through.
    #[test]
    fn only_loopback_authorities_are_admitted() {
        for authority in [
            "127.0.0.1:7001",
            "127.0.0.1",
            "127.9.9.9:7001",
            "[::1]:7001",
            "[::1]",
            "::1",
            "localhost",
            "localhost:7001",
            "LOCALHOST:7001",
            "app.localhost:5173",
        ] {
            assert!(
                authority_is_loopback(authority),
                "{authority} is this machine"
            );
        }

        for authority in [
            "evil.example:7001",
            "127.0.0.1.evil.example",
            "localhost.evil.example",
            "10.0.0.1",
            "192.168.1.7:7001",
            "[2001:db8::1]:7001",
            "notlocalhost",
            "",
            // A path is not part of an authority; a value carrying one is
            // not one, whatever it starts with.
            "localhost:7001/../evil",
        ] {
            assert!(
                !authority_is_loopback(authority),
                "{authority} is not this machine"
            );
        }
    }

    #[test]
    fn only_loopback_origins_are_admitted() {
        for origin in [
            "http://localhost:5173",
            "http://127.0.0.1:7001",
            "https://127.0.0.1",
            "http://[::1]:7001",
            "http://app.localhost:5173",
        ] {
            assert!(origin_is_loopback(origin), "{origin} is a page from here");
        }

        for origin in [
            "null",
            "http://evil.example",
            "https://evil.example:7001",
            "http://localhost.evil.example",
            "http://127.0.0.1.evil.example",
            "localhost:7001",
            "",
        ] {
            assert!(
                !origin_is_loopback(origin),
                "{origin} is not a page from here"
            );
        }
    }
}
