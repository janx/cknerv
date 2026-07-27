//! Thin wrapper over the `webbrowser` crate that logs but does not
//! crash if the browser launch fails (e.g. headless environment, no
//! display). Auto-open is a convenience, not a requirement — the
//! server stays up so the user can navigate manually.

pub fn open(port: u16) {
    let url = format!("http://localhost:{port}");
    if let Err(e) = webbrowser::open(&url) {
        tracing::warn!("could not auto-open browser: {e}. Open manually: {url}");
    } else {
        tracing::info!("opened browser at {url}");
    }
}
