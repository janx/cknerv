# Configuration

What `cknerv init` writes into `cknerv.toml`, how each value is resolved, and
which budgets are fixed rather than configurable. The merge rules are
[Design and Architecture §13.2](architecture.md#132-configuration-merge), and
the work directory those files live in is described in
[the README](../README.md#work-directory-structure).

`cknerv init` writes a commented `cknerv.toml` template:

```toml
[ckb]
rpc_url = "http://localhost:8114"

# Optional indexed semantics; disabled in the generated file.
# See docs/ckbadger.md before enabling.
# [ckbadger]
# api_url = "http://127.0.0.1:8101/api/v1"
# max_lag_blocks = 12

[dashboard]
port = 7001
hosted = false
open = true

[galaxy]
profile = "auto" # auto, devnet, testnet, mainnet, custom
recent_links_cap = 2048

[galaxy.topology]
neighbor_k = 5
max_edge_length = 42.0
max_hops = 80

[galaxy.pulses]
link_ring_capacity = 512
max_pulses_per_link = 6
max_origins_per_link = 2
max_active_pulses = 256
```

The generated ckbadger block is fully commented out, so a new work directory
keeps the direct CKB-only behavior. Setup and endpoint details live in
[ckbadger.md](ckbadger.md).

Profile defaults are resolved in `crates/cknerv-cli/src/config.rs`. Every
profile retains the built-in 50,000-Cell live reservoir (the renderer's
ceiling — not a knob). At an empty boot, the adapter anchors the current tip,
scans canonical blocks in reverse until it has identified that many outputs
still live at the anchor (or reaches genesis), then replays the cached window
once in ascending order.

`profile` currently selects no numbers: every profile resolves to the one
value set the SPA's own bundled defaults are pinned to, because a per-profile
delta that trailed a frontend retune twice shipped a galaxy nobody had
visually accepted. The seam is kept for a deliberate divergence, which would
arrive with its own parity fixture. Backfill is deliberately absent from
`cknerv.toml`; legacy `[backfill]` sections are ignored. Use
`--backfill-blocks N` only as a one-run hard scan limit for diagnostics.

The dashboard's manual Cell-count controller tops out at the built-in
50,000-Cell visual ceiling. AUTO renders the server-shipped display budget —
a fixed 12,000-Cell structural budget, with render quality adjusting
presentation only (DPR, effects, sampling), never composition — and the
passive nervous system draws a fixed 8,000-nerve screen budget regardless of
field size. The manual controller is a presentation clamp on that stage.
The manual controller keeps its full range but cannot display records the
server did not retain. A checkpoint recorded against a smaller historical
hydration target is invalidated automatically, so the next launch rebuilds
the full reservoir once. Legacy fixed-window checkpoints are treated the
same way. No manual purge is needed.

The top bar keeps a `PANELS` menu immediately after the build version. It
independently controls `CKB·01`, `ECG·04`, `CELL MESH`, and `PEER MESH`, plus
the optional `DAO·05` panel when validated DAO data is available, while
transport, source-health, warning, and replay status remain visible. The bar
folds to two rows when its one-row layout would not fit the viewport. That is
a measurement, not a screen size: the HUD renders a hidden copy of the row at
its natural width and folds when the room runs out, so an 11-inch iPad in
landscape keeps one row and a 10.2-inch one folds, and on today's content the
fold lands at about 1,100 pixels. Folded, identity and status stay in the
first row, while runtime controls occupy a horizontally scrollable second
row. The left HUD uses one bounded layout: CKB and DAO form a top row, with DAO
immediately to the right of CKB, while `ECG·04` is always anchored at the
bottom-left. The upper panels scroll within the remaining height, so they
cannot overlap the pulse panel.

`recent_links_cap` retains authoritative causal evidence for inspection and
memory recall. `pulses.link_ring_capacity` bounds only newly-arrived animation
events; snapshot history is never replayed as live traffic.

The exact reorg journal is independently bounded to 48 blocks. Deeper changes
trigger a controlled target-driven rebuild. A one-run `--backfill-blocks 0`
keeps legacy tip-only historical replay behavior; cknerv still retains the
exact rollback journal. Ordinary downtime catch-up always processes every
missing block so spends and births in the middle of the gap cannot be lost.

## Hosted Dashboards

Run cknerv, the CKB node, and optional ckbadger on the service machine, and set:

```toml
[dashboard]
port = 7001
hosted = "Little Otter"
```

| `hosted` value | Behavior |
|---|---|
| Omitted or `false` | Local mode; API Host and Origin must name loopback |
| Nonempty string | Public read-only mode; the string names the observed node |
| `true`, empty/blank text, other types | Configuration error |

Names are trimmed and preserve case and Unicode. Newlines and control
characters are rejected. TOML has no `null`: omit the key or use `false` to
disable it. The browser receives `hosted: string | null` in runtime config;
older/development payloads that omit it use local mode. The name is display
text, independent of domain, URL, RPC endpoint, and the stable `ckb:local` ID.
It appears on the node anchor, its inspection card, and the page title.
Peer heights and round trips are measurements from the service's node.

Hosted mode always suppresses browser auto-open on the service machine,
including when an existing generated config still says `open = true`.
`open` and `--no-open` keep their existing behavior in local mode. There is no
hosted CLI flag or environment override. Restart cknerv after editing the
config and refresh open pages to reload runtime config. Renaming the service
or returning to local mode re-registers the same node ID, preserving its
telemetry and derived state; no schema change or `cknerv purge` is required.

The listener remains `127.0.0.1:<port>` in both modes. Publish the hosted
dashboard at a domain's **root path** through a same-machine HTTPS reverse
proxy. Forward the SPA, `/runtime-config.js`, and `/api/*`, including WS
upgrades. HTTP requests already use the page's origin, and HTTPS pages select
`wss:` automatically. Subpath hosting and direct external binding are not
configured by `hosted`.

This deliberately publishes the existing read-only API, including node P2P
identity, peer addresses, versions and status, to anonymous readers. Public
Host/Origin headers and requests without Origin are accepted; public WS
streams can also be read by other origins. The SPA uses same-origin HTTP,
and no wildcard CORS policy is added. Leave Host/Origin intact at the proxy;
the server does not trust forwarded headers to bypass local-mode checks.
Keep CKB RPC and ckbadger behind the server-side boundary.

The proxy owns public connection/request limits and transport timeouts. Each
tab normally opens two long-lived streams, or three with enrichment, alongside
short HTTP requests. All viewers share one ingestion/projection pipeline;
their camera, quality, panels and audio controls remain browser-local.
The Cell data route's two upstream permits and 2 MiB response bound continue
to apply, but neither the permit waiters nor total WS connections have an
application-wide admission limit.

For example, the following belongs inside an nginx `http` block. Replace the
domain and certificate paths. These limits are example deployment budgets;
size them for concurrent viewers, shared-IP clients, snapshot bandwidth and
the upstream node's capacity.

```nginx
map $http_upgrade $cknerv_connection {
    default upgrade;
    '' close;
}
limit_conn_zone $binary_remote_addr zone=cknerv_ip:10m;
limit_conn_zone $server_name zone=cknerv_total:1m;
limit_req_zone $binary_remote_addr zone=cknerv_rate:10m rate=20r/s;

server {
    listen 443 ssl;
    server_name nerv.example;
    ssl_certificate /etc/ssl/nerv.example/fullchain.pem;
    ssl_certificate_key /etc/ssl/nerv.example/privkey.pem;
    limit_conn cknerv_ip 16;
    limit_conn cknerv_total 128;
    limit_conn_status 429;
    limit_req zone=cknerv_rate burst=80 nodelay;
    limit_req_status 429;

    location / {
        proxy_pass http://127.0.0.1:7001;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Origin $http_origin;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $cknerv_connection;
        proxy_buffering off;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

nginx requires explicit forwarding of the upgrade headers for WS; its
[WebSocket guide](https://nginx.org/en/docs/http/websocket.html) explains the
handshake and idle timeout. Its [connection limits](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)
and [request limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
describe how the example budgets are enforced. Validate the proxy's config
before reloading it, then follow the [hosted smoke checklist](../crates/cknerv-cli/SMOKE.md#hosted-mode).

Detail-route failures and ckbadger probe status expose diagnostic summaries.
Underlying errors are logged on the service machine; RPC/API URLs, request
credentials and workdir paths are not added to browser runtime config.
