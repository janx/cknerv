//! `get_peers` / `sync_state` / `local_node_info` parsing into
//! chain-generic mutations, plus the slow network poll cycle.

use anyhow::{anyhow, Result};
use serde_json::Value;
use tokio::sync::mpsc;

use cknerv_core::{Mutation, Peer, PeerDirection};

use crate::rpc::RpcClient;

/// Parse a hex-or-decimal JSON string/number into u64; None if absent.
fn opt_u64(v: &Value) -> Option<u64> {
    match v {
        Value::String(s) => u64::from_str_radix(s.trim_start_matches("0x"), 16).ok(),
        Value::Number(n) => n.as_u64(),
        _ => None,
    }
}

/// Extract a friendly "ip:port" from a libp2p multiaddr like
/// `/ip4/1.2.3.4/tcp/8115/p2p/Qm...`. Falls back to the raw string.
pub(crate) fn addr_from_multiaddr(s: &str) -> String {
    let parts: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();
    let mut ip: Option<&str> = None;
    let mut port: Option<&str> = None;
    let mut i = 0;
    while i + 1 < parts.len() {
        match parts[i] {
            "ip4" | "ip6" | "dns4" | "dns6" => ip = Some(parts[i + 1]),
            "tcp" => port = Some(parts[i + 1]),
            _ => {}
        }
        i += 1;
    }
    match (ip, port) {
        (Some(ip), Some(port)) => format!("{ip}:{port}"),
        (Some(ip), None) => ip.to_string(),
        _ => s.to_string(),
    }
}

/// Parse `get_peers` result (array of RemoteNode) into `Vec<Peer>`.
pub(crate) fn parse_peers(result: &Value) -> Result<Vec<Peer>> {
    let arr = result
        .as_array()
        .ok_or_else(|| anyhow!("get_peers: expected array"))?;
    let mut out = Vec::with_capacity(arr.len());
    for p in arr {
        let node_id = p["node_id"].as_str().unwrap_or("").to_string();
        let version = p["version"].as_str().unwrap_or("").to_string();
        let direction = if p["is_outbound"].as_bool().unwrap_or(false) {
            PeerDirection::Outbound
        } else {
            PeerDirection::Inbound
        };
        // best-scored address (addresses[].score is hex); fall back to first.
        let addr = p["addresses"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .max_by_key(|e| opt_u64(&e["score"]).unwrap_or(0))
                    .or_else(|| a.first())
            })
            .and_then(|e| e["address"].as_str())
            .map(addr_from_multiaddr)
            .unwrap_or_default();
        let latency_ms = opt_u64(&p["last_ping_duration"]);
        let best_known = p
            .get("sync_state")
            .and_then(|s| s.get("best_known_header_number"))
            .and_then(opt_u64);
        let connected_ms = opt_u64(&p["connected_duration"]).unwrap_or(0);
        out.push(Peer {
            node_id,
            addr,
            direction,
            version,
            latency_ms,
            best_known,
            connected_ms,
        });
    }
    Ok(out)
}

/// Parse `sync_state` → (ibd, best_known_block).
pub(crate) fn parse_sync_state(result: &Value) -> (bool, u64) {
    let ibd = result["ibd"].as_bool().unwrap_or(false);
    let best = opt_u64(&result["best_known_block_number"]).unwrap_or(0);
    (ibd, best)
}

/// Parse `local_node_info` → (version, connections).
pub(crate) fn parse_local_node_info(result: &Value) -> (String, u64) {
    let version = result["version"].as_str().unwrap_or("").to_string();
    let connections = opt_u64(&result["connections"]).unwrap_or(0);
    (version, connections)
}

/// Build the mutation set for one network poll from already-fetched
/// JSON. Split out from `poll_network_once` so it is unit-testable
/// without an RPC transport.
pub(crate) fn network_mutations(
    peers_json: &Value,
    sync_json: &Value,
    lni_json: &Value,
    node_id: &str,
) -> Result<Vec<Mutation>> {
    let peers = parse_peers(peers_json)?;
    let (ibd, best_known_block) = parse_sync_state(sync_json);
    let (version, connections) = parse_local_node_info(lni_json);
    Ok(vec![
        Mutation::PeersUpdated { peers },
        Mutation::ChainSyncUpdated {
            ibd,
            best_known_block,
        },
        Mutation::ChainNodeInfoUpdated {
            id: node_id.to_string(),
            version,
            connections,
        },
    ])
}

/// Run one network poll: fetch peers / sync / local-node-info and emit
/// the corresponding mutations. Individual sub-fetch failures are
/// surfaced as an error for the caller to log; the adapter keeps looping.
pub(crate) async fn poll_network_once(
    rpc: &RpcClient,
    node_id: &str,
    out: &mpsc::Sender<Mutation>,
) -> Result<()> {
    let peers_json = rpc.get_peers().await?;
    let sync_json = rpc.sync_state().await?;
    let lni_json = rpc.local_node_info().await?;
    for m in network_mutations(&peers_json, &sync_json, &lni_json, node_id)? {
        let _ = out.send(m).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addr_from_multiaddr_extracts_ip_port() {
        assert_eq!(
            addr_from_multiaddr("/ip4/203.0.113.9/tcp/8115/p2p/QmX"),
            "203.0.113.9:8115"
        );
        assert_eq!(addr_from_multiaddr("garbage"), "garbage");
    }

    #[test]
    fn parse_peers_maps_fields() {
        let v = serde_json::json!([
            {
                "node_id": "QmA",
                "version": "0.116.1",
                "is_outbound": true,
                "addresses": [
                    { "address": "/ip4/1.1.1.1/tcp/8115", "score": "0x1" },
                    { "address": "/ip4/2.2.2.2/tcp/8115", "score": "0x64" }
                ],
                "last_ping_duration": "0x1f",
                "connected_duration": "0x3e8",
                "sync_state": { "best_known_header_number": "0x64" }
            },
            {
                "node_id": "QmB",
                "version": "0.115.0",
                "is_outbound": false,
                "addresses": [],
                "connected_duration": "0x5"
            }
        ]);
        let peers = parse_peers(&v).expect("parse");
        assert_eq!(peers.len(), 2);
        assert_eq!(peers[0].node_id, "QmA");
        assert_eq!(peers[0].direction, PeerDirection::Outbound);
        assert_eq!(peers[0].addr, "2.2.2.2:8115"); // highest score wins
        assert_eq!(peers[0].latency_ms, Some(31));
        assert_eq!(peers[0].best_known, Some(100));
        assert_eq!(peers[1].direction, PeerDirection::Inbound);
        assert_eq!(peers[1].latency_ms, None);
        assert_eq!(peers[1].best_known, None);
    }

    #[test]
    fn parse_sync_state_reads_ibd_and_best() {
        let v = serde_json::json!({ "ibd": true, "best_known_block_number": "0x2a" });
        assert_eq!(parse_sync_state(&v), (true, 42));
    }

    #[test]
    fn parse_local_node_info_reads_version_connections() {
        let v = serde_json::json!({ "version": "0.116.1", "connections": "0x18" });
        assert_eq!(parse_local_node_info(&v), ("0.116.1".to_string(), 24));
    }

    #[test]
    fn network_mutations_emits_three() {
        let peers = serde_json::json!([]);
        let sync = serde_json::json!({ "ibd": false, "best_known_block_number": "0x5" });
        let lni = serde_json::json!({ "version": "0.116.1", "connections": "0x2" });
        let muts = network_mutations(&peers, &sync, &lni, "ckb:local").expect("ok");
        assert_eq!(muts.len(), 3);
        assert!(matches!(muts[0], Mutation::PeersUpdated { .. }));
        assert!(matches!(
            muts[1],
            Mutation::ChainSyncUpdated {
                best_known_block: 5,
                ..
            }
        ));
        match &muts[2] {
            Mutation::ChainNodeInfoUpdated {
                id,
                version,
                connections,
            } => {
                assert_eq!(id, "ckb:local");
                assert_eq!(version, "0.116.1");
                assert_eq!(*connections, 2);
            }
            _ => panic!("expected ChainNodeInfoUpdated"),
        }
    }
}
