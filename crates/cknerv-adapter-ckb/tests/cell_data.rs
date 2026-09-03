//! `CkbCellDataReader` against a canned CKB node.
//!
//! The reader's whole job is to turn a node's two-part answer into the three
//! outcomes the route needs — the bytes, an honest absence, or a fault — so
//! these tests drive the node's side of that: a live cell, a spent one whose
//! creating transaction is committed, a transaction still in the mempool, a
//! hash the node has never heard of, and an index past the outputs.

mod mock_rpc;

use ckb_hash::blake2b_256;
use ckb_types::{packed, prelude::*};
use serde_json::{json, Value};

use cknerv_adapter_ckb::CkbCellDataReader;
use cknerv_core::OutPoint;
use cknerv_server::CellDataReader;

const LIVE_TX: &str = "0x1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a";
const SPENT_TX: &str = "0x2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b";
const PENDING_TX: &str = "0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c";
const UNKNOWN_TX: &str = "0x4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d";

/// The hash the node reports for the live fixture's data. Deliberately NOT
/// the BLAKE2b of that content: the live path passes `cell.data.hash`
/// through, and a fixture whose two values agreed could not tell a
/// pass-through from a recomputation.
const NODE_REPORTED_HASH: &str =
    "0x9999999999999999999999999999999999999999999999999999999999999999";

const ZERO_HASH: &str = "0x0000000000000000000000000000000000000000000000000000000000000000";

fn out_point(tx_hash: &str, index: u32) -> OutPoint {
    OutPoint {
        tx_hash: tx_hash.to_string(),
        index,
    }
}

fn live_cell(content: &str, hash: &str) -> Value {
    json!({
        "status": "live",
        "cell": {
            "output": {
                "capacity": "0xae0bc7e000",
                "lock": {
                    "code_hash": ZERO_HASH,
                    "hash_type": "data",
                    "args": "0x"
                },
                "type": null
            },
            "data": { "content": content, "hash": hash }
        }
    })
}

fn transaction(status: &str, outputs_data: Vec<&str>) -> Value {
    json!({
        "transaction": { "outputs_data": outputs_data },
        "tx_status": { "status": status, "block_hash": ZERO_HASH }
    })
}

/// A node that knows one live cell, one spent-but-committed transaction and
/// one transaction still in the mempool.
async fn canned_node() -> (CkbCellDataReader, tokio::task::JoinHandle<()>) {
    let mut canned = mock_rpc::CannedResponses::default();
    canned.live_cells.insert(
        (LIVE_TX.to_string(), 2),
        live_cell("0x73706f7265", NODE_REPORTED_HASH),
    );
    canned.transactions.insert(
        SPENT_TX.to_string(),
        transaction("committed", vec!["0x", "0xdeadbeef"]),
    );
    canned
        .transactions
        .insert(PENDING_TX.to_string(), transaction("pending", vec!["0x01"]));
    let (url, handle) = mock_rpc::start(canned).await;
    (CkbCellDataReader::new(url), handle)
}

#[tokio::test]
async fn a_live_cell_hands_back_its_bytes_and_the_nodes_own_hash() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(LIVE_TX, 2))
        .await
        .expect("the node answered")
        .expect("the node holds this outpoint");

    assert_eq!(data.bytes, b"spore".to_vec());
    assert_eq!(
        data.data_hash, NODE_REPORTED_HASH,
        "the node already hashed the data it is holding; we do not hash it again"
    );
    assert!(data.live);
}

#[tokio::test]
async fn a_spent_cell_is_read_from_its_committed_transaction() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(SPENT_TX, 1))
        .await
        .expect("the node answered")
        .expect("the creating transaction is still committed");

    assert_eq!(data.bytes, vec![0xde, 0xad, 0xbe, 0xef]);
    assert!(!data.live, "the output is spent; its bytes are not");
    assert_eq!(
        data.data_hash,
        format!("0x{}", hex::encode(blake2b_256([0xde, 0xad, 0xbe, 0xef]))),
        "non-empty data hashes the way the chain hashes it"
    );
    assert_eq!(
        data.data_hash,
        format!(
            "0x{}",
            hex::encode(packed::CellOutput::calc_data_hash(&[0xde, 0xad, 0xbe, 0xef]).as_slice())
        ),
        "and that is exactly what `calc_data_hash` returns"
    );
    assert_ne!(
        data.data_hash,
        format!("0x{}", hex::encode(blake2b_256([]))),
        "the empty-data special case is a special case, not the general rule"
    );
    assert_ne!(data.data_hash, ZERO_HASH);
}

#[tokio::test]
async fn a_spent_cell_holding_nothing_carries_the_zero_hash() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(SPENT_TX, 0))
        .await
        .expect("the node answered")
        .expect("the creating transaction is still committed");

    assert!(data.bytes.is_empty());
    assert_eq!(
        data.data_hash, ZERO_HASH,
        "CKB hashes empty cell data to the zero hash, and a hand-rolled BLAKE2b would not"
    );
    assert_ne!(
        data.data_hash,
        format!("0x{}", hex::encode(blake2b_256([]))),
        "the BLAKE2b of an empty slice is a different 32 bytes entirely"
    );
}

#[tokio::test]
async fn a_transaction_still_in_the_mempool_is_not_chain_truth() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(PENDING_TX, 0))
        .await
        .expect("the node answered");

    assert!(
        data.is_none(),
        "a pending transaction's outputs do not exist yet, and may never"
    );
}

#[tokio::test]
async fn a_transaction_the_node_never_heard_of_is_an_absence() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(UNKNOWN_TX, 0))
        .await
        .expect("the node answered");

    assert!(
        data.is_none(),
        "no live cell and no transaction is what proves the outpoint is not real"
    );
}

#[tokio::test]
async fn an_index_past_the_outputs_is_an_absence() {
    let (reader, _server) = canned_node().await;

    let data = reader
        .read_output_data(&out_point(SPENT_TX, 7))
        .await
        .expect("the node answered");

    assert!(
        data.is_none(),
        "the transaction is real and this output of it is not"
    );
}
