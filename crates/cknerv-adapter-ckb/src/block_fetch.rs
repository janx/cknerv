//! Fetch a block by number, translate its transactions into
//! cknerv_core::Mutation::BlockMined + TxLanded events.
//!
//! Algorithm mirrors `simulator/src/telemetry/chain_poll.rs::fetch_block`
//! so cknerv-adapter-ckb and simulator emit byte-identical Mutations for
//! the same on-chain block (cells, hashes, capacities, content hashes).

use anyhow::{anyhow, Context, Result};
use ckb_types::{packed, prelude::*};
use serde_json::Value;

use cknerv_core::{Mutation, OutPoint, TxOutputInfo, DATA_HEX_TRUNCATION_MARKER};

use crate::content_hash::compute_content_hash;
use crate::rpc::RpcClient;
use crate::shape_seed::{collection_seed, data_shape_seed, script_shape_seed};

/// One fully-translated canonical block plus the header linkage needed by
/// the live poller to reject a mixed-fork fetch.
pub struct FetchedBlock {
    pub hash: String,
    pub parent_hash: String,
    pub mutations: Vec<Mutation>,
}

/// Truncation cap that matches simulator's `truncate_hex` so wire bytes
/// agree. Source bytes (= 2× hex chars without the `0x` prefix).
const DATA_HEX_CAP_BYTES: usize = 1024;

/// Fetch + translate block `number`. Returns mutations in emit order:
/// 1. `BlockMined { number, hash, tx_count, size, at, producer_* }`
/// 2. for each tx (including cellbase): `TxLanded { tx_hash, block, inputs, outputs, at }`
///
/// Returns `Ok(None)` if the block isn't visible yet (RPC race), letting the
/// poll loop retry on the next tick.
pub async fn fetch_and_translate(rpc: &RpcClient, number: u64) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_with_time(rpc, number, BlockTimeSource::Observed, true).await
}

/// Fetch + translate a block that is being replayed rather than observed at
/// the live tip. Historical catch-up/reorg/rebuild blocks must retain their
/// header timestamps; stamping a fast replay with wall-clock receipt times
/// collapses the cadence ring to 0–2ms and makes the HUD report a permanent
/// false stall once replay completes.
pub(crate) async fn fetch_and_translate_replay(
    rpc: &RpcClient,
    number: u64,
) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_replay_with_size(rpc, number, true).await
}

/// Replay fetch with optional canonical serialized-size recovery. Only the
/// latest rolling metrics window needs exact block sizes during a deep boot
/// hydration; skipping the full JSON -> typed BlockView clone for older
/// blocks substantially reduces discovery allocations without changing Cell
/// or transaction mutations.
pub(crate) async fn fetch_and_translate_replay_with_size(
    rpc: &RpcClient,
    number: u64,
    include_size: bool,
) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_with_time(rpc, number, BlockTimeSource::Header, include_size).await
}

#[derive(Clone, Copy)]
enum BlockTimeSource {
    Observed,
    Header,
}

async fn fetch_and_translate_with_time(
    rpc: &RpcClient,
    number: u64,
    time_source: BlockTimeSource,
    include_size: bool,
) -> Result<Option<FetchedBlock>> {
    let Some(block) = rpc.get_block_by_number(number).await? else {
        return Ok(None);
    };
    let observed_at = now_ms();
    let at = block_time_ms(&block, time_source, observed_at);
    let size = if include_size {
        serialized_block_size(&block)
    } else {
        0
    };
    let hash = header_hash(&block, number)?.to_string();
    let parent_hash = header_parent_hash(&block, number)?.to_string();
    let mutations = translate_block(&block, number, at, size)?;
    Ok(Some(FetchedBlock {
        hash,
        parent_hash,
        mutations,
    }))
}

fn block_time_ms(block: &Value, source: BlockTimeSource, observed_at: u64) -> u64 {
    match source {
        BlockTimeSource::Observed => observed_at,
        BlockTimeSource::Header => header_timestamp_ms(block).unwrap_or(observed_at),
    }
}

pub(crate) fn header_hash(block: &Value, number: u64) -> Result<&str> {
    block["header"]["hash"]
        .as_str()
        .ok_or_else(|| anyhow!("block {number}: missing header.hash"))
}

pub(crate) fn header_parent_hash(block: &Value, number: u64) -> Result<&str> {
    block["header"]["parent_hash"]
        .as_str()
        .ok_or_else(|| anyhow!("block {number}: missing header.parent_hash"))
}

/// Canonical serialized block size (bytes), recovered by round-tripping the
/// verbosity-0x2 JSON block back into packed form. Returns 0 if the value
/// isn't a complete BlockView (e.g. partial test fixtures) — callers treat 0
/// as "unknown" (uniform-width beat).
pub fn serialized_block_size(block: &Value) -> u64 {
    serde_json::from_value::<ckb_jsonrpc_types::BlockView>(block.clone())
        .map(|bv| {
            let core: ckb_types::core::BlockView = bv.into();
            core.data().as_slice().len() as u64
        })
        .unwrap_or(0)
}

/// Pure translation helper — split out so tests can exercise it without
/// a live RPC. The `at` timestamp is injected so deterministic fixtures
/// produce deterministic output.
pub fn translate_block(block: &Value, number: u64, at: u64, size: u64) -> Result<Vec<Mutation>> {
    let header_hash = header_hash(block, number)?.to_string();

    let txs = block["transactions"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let tx_count =
        u32::try_from(txs.len()).map_err(|_| anyhow!("block {number}: tx_count exceeds u32"))?;

    let (producer_key, producer_message) = cellbase_producer(txs).unzip();

    let mut out = Vec::with_capacity(1 + txs.len());
    out.push(Mutation::BlockMined {
        number,
        hash: header_hash,
        tx_count,
        size,
        at,
        producer_key,
        producer_message,
    });

    for t in txs {
        let tx_hash = t["hash"]
            .as_str()
            .ok_or_else(|| anyhow!("block {number}: tx missing hash"))?
            .to_string();

        let inputs = parse_inputs(t, &tx_hash)?;
        let outputs = parse_outputs(t, &tx_hash)?;

        out.push(Mutation::TxLanded {
            tx_hash,
            block: number,
            at,
            inputs,
            outputs,
        });
    }

    Ok(out)
}

/// The block's own producer, read out of the cellbase witness: its lock
/// script hash as the identity key, and its declared message.
///
/// ⭐⭐⭐ The miner is `CellbaseWitness.lock`, **never the cellbase OUTPUT
/// lock**. CKB pays the block reward eleven confirmations back, so block N's
/// cellbase output pays whoever mined block N−11; only the witness names the
/// producer of the block carrying it. Reading the output instead would shift
/// every attribution by eleven blocks while leaving the aggregate
/// distribution identical — the same multiset of producers, so a share
/// readout, a distribution table, even a flood-origin oracle would all still
/// agree. On a chain where one producer takes most blocks the two locks also
/// coincide by luck most of the time, which is why the test that pins this
/// has to assert the two are DIFFERENT and that the witness one won.
///
/// ⚠️ The molecule is [`packed::CellbaseWitness`] (RFC-0022: `lock: Script,
/// message: Bytes`), **not `WitnessArgs`** — different tables with different
/// field counts. Reading this one as `WitnessArgs` is the historical bug that
/// makes miner messages come back empty.
///
/// `None` is a first-class answer that travels all the way up: a block whose
/// producer we cannot read is still a block cknerv must show, so a missing,
/// malformed or nameless witness returns `None` rather than failing the whole
/// translation. Both halves are read from one witness, so they are `Some`
/// together or `None` together.
fn cellbase_producer(txs: &[Value]) -> Option<(String, String)> {
    let witness_hex = txs.first()?.get("witnesses")?.get(0)?.as_str()?;
    let witness_body = witness_hex.strip_prefix("0x").unwrap_or(witness_hex);
    let witness = packed::CellbaseWitness::from_slice(&hex::decode(witness_body).ok()?).ok()?;

    let lock = witness.lock();
    // ⭐ Genesis DOES carry a structurally valid `CellbaseWitness` — mainnet's
    // is 69 bytes and parses — but its lock is the null script: zero code
    // hash, `data` hash type, no args. Nobody mined genesis. Hashing that
    // script anyway would mint a well-formed 64-hex key out of a declaration
    // that names no one, and everything above here reads a key as an
    // identity. No code cell hashes to zero, so a zero code hash is exactly
    // the shape of "nobody".
    if lock.code_hash().is_zero() {
        return None;
    }
    let key = format!("0x{}", hex::encode(lock.calc_script_hash().raw_data()));

    // Miners that write a message at all pad it with NUL bytes (mainnet's
    // carry a four-byte zero head and often a zero tail). Strip the padding
    // off both ends — NULs have no business on a wire this repo reads back as
    // text — and leave everything between exactly as declared. It is the
    // miner talking, not us measuring.
    let declared = witness.message().raw_data();
    let message = String::from_utf8_lossy(&declared)
        .trim_matches(|c: char| c.is_control() || c.is_whitespace())
        .to_string();

    Some((key, message))
}

fn parse_inputs(tx: &Value, tx_hash: &str) -> Result<Vec<OutPoint>> {
    let inputs_json = tx["inputs"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let mut inputs = Vec::with_capacity(inputs_json.len());
    for (j, inp) in inputs_json.iter().enumerate() {
        let prev = &inp["previous_output"];
        let prev_tx_hash = prev["tx_hash"]
            .as_str()
            .ok_or_else(|| anyhow!("tx {tx_hash} input[{j}]: missing previous_output.tx_hash"))?
            .to_string();
        let index = parse_hex_u32(
            &prev["index"],
            &format!("tx {tx_hash} input[{j}].previous_output.index"),
        )?;
        inputs.push(OutPoint {
            tx_hash: prev_tx_hash,
            index,
        });
    }
    Ok(inputs)
}

fn parse_outputs(tx: &Value, tx_hash: &str) -> Result<Vec<TxOutputInfo>> {
    let outputs_json = tx["outputs"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let outputs_data = tx["outputs_data"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut outputs = Vec::with_capacity(outputs_json.len());
    for (i, o) in outputs_json.iter().enumerate() {
        let raw_data_str = outputs_data
            .get(i)
            .and_then(|d| d.as_str())
            .ok_or_else(|| anyhow!("tx {tx_hash} output[{i}]: missing outputs_data entry"))?;
        outputs.push(parse_output_info(
            o,
            raw_data_str,
            &format!("tx {tx_hash} output[{i}]"),
        )?);
    }
    Ok(outputs)
}

pub(crate) fn parse_output_info(
    output: &Value,
    raw_data_str: &str,
    context: &str,
) -> Result<TxOutputInfo> {
    let capacity = parse_hex_u64(&output["capacity"], &format!("{context}.capacity"))?;
    let raw_data_body = raw_data_str.strip_prefix("0x").unwrap_or(raw_data_str);
    let raw_data_bytes = hex::decode(raw_data_body)
        .map_err(|error| anyhow!("{context}: output data is not valid hex: {error}"))?;

    let lock_json: ckb_jsonrpc_types::Script = serde_json::from_value(output["lock"].clone())
        .map_err(|error| anyhow!("{context}.lock: {error}"))?;
    let type_json: Option<ckb_jsonrpc_types::Script> = match output.get("type") {
        Some(Value::Null) | None => None,
        Some(value) => Some(
            serde_json::from_value(value.clone())
                .map_err(|error| anyhow!("{context}.type: {error}"))?,
        ),
    };
    let lock: packed::Script = lock_json.into();
    let type_: Option<packed::Script> = type_json.map(Into::into);
    let lock_kind = crate::script_taxonomy::classify_lock(&lock);
    let asset_kind = crate::script_taxonomy::classify_asset(type_.as_ref());
    let lock_script = crate::script_taxonomy::script_id(&lock);
    let type_script = type_.as_ref().map(crate::script_taxonomy::script_id);
    let lock_shape_seed = script_shape_seed(&lock);
    let type_shape_seed = type_.as_ref().map(script_shape_seed);
    let data_shape_seed = data_shape_seed(&raw_data_bytes);
    // Reads the FULL data, which only this side of the truncation has: a
    // spore's cluster id sits after its content in the molecule table, so
    // `data_hex` is capped short of it by construction.
    let collection_seed = collection_seed(type_.as_ref(), &raw_data_bytes);
    let data_bytes =
        u32::try_from(raw_data_bytes.len()).context("Cell output data length exceeds u32")?;
    let cell_output = packed::CellOutput::new_builder()
        .capacity(capacity)
        .lock(lock)
        .type_(type_.pack())
        .build();

    Ok(TxOutputInfo {
        capacity,
        data_hex: truncate_hex(raw_data_str, DATA_HEX_CAP_BYTES),
        data_bytes,
        content_hash: compute_content_hash(&cell_output, &raw_data_bytes),
        lock_shape_seed,
        type_shape_seed,
        data_shape_seed,
        lock_kind,
        asset_kind,
        lock_script,
        type_script,
        collection_seed,
    })
}

fn parse_hex_u64(v: &Value, field: &str) -> Result<u64> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow!("{field}: missing or non-string"))?;
    u64::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("{field}: bad hex {s:?}: {e}"))
}

fn parse_hex_u32(v: &Value, field: &str) -> Result<u32> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow!("{field}: missing or non-string"))?;
    u32::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("{field}: bad hex {s:?}: {e}"))
}

/// Same `truncate_hex` policy as simulator's chain_poll. Caps the
/// hex-encoded data at `byte_cap` source bytes; appends
/// [`DATA_HEX_TRUNCATION_MARKER`] when truncation occurs so consumers can
/// detect it. The marker rides the columnar snapshot's ASCII string blob,
/// so it must stay single-byte.
fn truncate_hex(s: &str, byte_cap: usize) -> String {
    let body = s.strip_prefix("0x").unwrap_or(s);
    let char_cap = byte_cap * 2;
    if body.len() <= char_cap {
        s.to_string()
    } else {
        format!("0x{}{DATA_HEX_TRUNCATION_MARKER}", &body[..char_cap])
    }
}

/// Parse the block header's `timestamp` (CKB ships it as a hex-encoded
/// ms-since-epoch string). Returns `None` when absent or unparseable so
/// callers can fall back to wall-clock time.
pub fn header_timestamp_ms(block: &Value) -> Option<u64> {
    let s = block["header"]["timestamp"].as_str()?;
    u64::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output_json(capacity: u64, lock_args: &[u8], type_args: Option<&[u8]>) -> Value {
        let script = |code_byte: u8, args: &[u8]| {
            serde_json::json!({
                "code_hash": format!("0x{}", hex::encode([code_byte; 32])),
                "hash_type": "type",
                "args": format!("0x{}", hex::encode(args)),
            })
        };
        serde_json::json!({
            "capacity": format!("0x{capacity:x}"),
            "lock": script(0x11, lock_args),
            "type": type_args.map(|args| script(0x22, args)),
        })
    }

    fn cellbase_block_json(number: u64, hash: &str) -> Value {
        // Minimal block with a single cellbase tx (one phantom input + one output).
        serde_json::json!({
            "header": {
                "hash": hash,
                "number": format!("0x{:x}", number),
            },
            "transactions": [{
                "hash": format!("0x{:064x}", 0xc0ffee_u64 ^ number),
                "inputs": [{
                    "previous_output": {
                        "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                        "index": "0xffffffff"
                    },
                    "since": "0x0"
                }],
                "outputs": [{
                    "capacity": "0xae0bc7e000",
                    "lock": {
                        "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                        "hash_type": "data",
                        "args": "0x"
                    },
                    "type": null
                }],
                "outputs_data": ["0x"]
            }]
        })
    }

    #[test]
    fn translate_block_emits_block_mined_first() {
        let block = cellbase_block_json(7, "0xblock7");
        let muts = translate_block(&block, 7, 42, 0).expect("translate ok");
        assert!(
            muts.len() >= 2,
            "expected BlockMined + at least one TxLanded"
        );
        match &muts[0] {
            Mutation::BlockMined {
                number,
                hash,
                tx_count,
                size,
                at,
                producer_key,
                producer_message,
            } => {
                assert_eq!(*number, 7);
                assert_eq!(hash, "0xblock7");
                assert_eq!(*tx_count, 1);
                assert_eq!(*size, 0);
                assert_eq!(*at, 42);
                // This fixture's cellbase carries no witness at all, and a
                // block whose producer we cannot read is still a block.
                assert_eq!(*producer_key, None);
                assert_eq!(*producer_message, None);
            }
            other => panic!("expected BlockMined first, got {other:?}"),
        }
    }

    /// The secp256k1_blake160_sighash_all code hash every mainnet cellbase
    /// lock uses, on both sides of the pair below.
    const SIGHASH_CODE_HASH: &str =
        "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";

    /// `transactions[0].witnesses[0]` of mainnet block 20,259,445, verbatim
    /// as the node serves it. Its lock args are `0xeb0c0007…d7d6` and its
    /// message is NUL-padded on both ends.
    const BLOCK_20259445_WITNESS: &str = "0x7f0000000c000000550000004900000010000000300000\
         00310000009bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce80114000000eb\
         0c00079f76e90b970d236bbf845d9a501de7d6260000000000000020302e3230392e30202837653331663\
         73520323032362d30372d3330292000000000";

    /// Same block's cellbase OUTPUT lock args. Different identity: the
    /// reward it pays belongs to whoever mined block 20,259,434.
    const BLOCK_20259445_OUTPUT_LOCK_ARGS: &str = "0x8805eaf629140c223ece7e2ad8e2a01acb8695f9";

    /// `transactions[0].witnesses[0]` of CKB mainnet genesis, verbatim. It
    /// is a structurally valid `CellbaseWitness` — 69 bytes, two fields —
    /// carrying the null script and an empty message.
    const GENESIS_WITNESS: &str = "0x450000000c000000410000003500000010000000300000003100000000\
         00000000000000000000000000000000000000000000000000000000000000000000000000000000";

    fn sighash_lock_json(args: &str) -> Value {
        serde_json::json!({
            "code_hash": SIGHASH_CODE_HASH,
            "hash_type": "type",
            "args": args,
        })
    }

    /// A one-cellbase block whose witness list and output lock are both
    /// supplied, so a test can make the two miner locks disagree.
    fn cellbase_block_with(witnesses: Option<Value>, output_lock: Value) -> Value {
        let mut tx = serde_json::json!({
            "hash": format!("0x{:064x}", 1),
            "inputs": [{
                "previous_output": {
                    "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                    "index": "0xffffffff"
                },
                "since": "0x0"
            }],
            "outputs": [{
                "capacity": "0xae0bc7e000",
                "lock": output_lock,
                "type": null
            }],
            "outputs_data": ["0x"]
        });
        if let Some(witnesses) = witnesses {
            tx["witnesses"] = witnesses;
        }
        serde_json::json!({
            "header": { "hash": "0xblock", "number": "0x1" },
            "transactions": [tx]
        })
    }

    fn producer_of(block: &Value) -> (Option<String>, Option<String>) {
        let muts = translate_block(block, 1, 42, 0).expect("a block still translates");
        match &muts[0] {
            Mutation::BlockMined {
                producer_key,
                producer_message,
                ..
            } => (producer_key.clone(), producer_message.clone()),
            other => panic!("expected BlockMined first, got {other:?}"),
        }
    }

    /// ⭐⭐⭐ The pin the whole producer feature rests on.
    ///
    /// CKB pays the block reward eleven confirmations back, so every
    /// cellbase carries TWO miner locks: the OUTPUT lock pays whoever mined
    /// eleven blocks earlier, and only the WITNESS lock names the producer of
    /// the block carrying it. Reading the output instead shifts every
    /// attribution by eleven while leaving the aggregate distribution
    /// identical — so a test that only asserted "a key came back" would pass
    /// under the bug, and so would every share readout downstream.
    ///
    /// The vector is mainnet block 20,259,445, chosen because its two locks
    /// DISAGREE: on a chain where one producer takes most of the blocks they
    /// coincide by luck most of the time. This test asserts the disagreement
    /// first — if a future edit ever made the two locks equal, the pin would
    /// be worthless and must fail loudly rather than pass vacuously.
    #[test]
    fn the_producer_is_the_cellbase_witness_lock_never_the_output_lock() {
        let output_lock_json = sighash_lock_json(BLOCK_20259445_OUTPUT_LOCK_ARGS);
        let block = cellbase_block_with(
            Some(serde_json::json!([BLOCK_20259445_WITNESS])),
            output_lock_json.clone(),
        );

        // Both locks, as packed scripts, straight from the block.
        let witness_bytes = hex::decode(BLOCK_20259445_WITNESS.trim_start_matches("0x")).unwrap();
        let witness_lock = packed::CellbaseWitness::from_slice(&witness_bytes)
            .expect("a real cellbase witness parses as CellbaseWitness")
            .lock();
        let output_lock: packed::Script =
            serde_json::from_value::<ckb_jsonrpc_types::Script>(output_lock_json)
                .unwrap()
                .into();

        // The premise. Without it the rest of this test proves nothing.
        assert_ne!(
            witness_lock.args().raw_data(),
            output_lock.args().raw_data(),
            "this vector was chosen because its two miner locks differ"
        );

        let hash_of = |script: &packed::Script| {
            format!("0x{}", hex::encode(script.calc_script_hash().raw_data()))
        };
        let (key, message) = producer_of(&block);
        let key = key.expect("a mined block names its producer");

        assert_eq!(
            key,
            hash_of(&witness_lock),
            "the producer key must be the WITNESS lock's script hash"
        );
        assert_ne!(
            key,
            hash_of(&output_lock),
            "the cellbase OUTPUT lock pays the miner of eleven blocks ago; \
             attributing by it shifts every block while leaving the \
             distribution identical"
        );

        // Pinned literals, so a change in how the hash is computed fails here
        // rather than agreeing with itself, and an independent blake2b of the
        // packed script proves the key is the ckb-default-hash script hash.
        assert_eq!(
            key,
            "0xfc20a8c81a461efaf91585c631db784749d066f709d30243095efda7a7fdcfd9"
        );
        assert_eq!(
            hash_of(&output_lock),
            "0xbccf17b39f4295b62ce19f8475f873914021df57d15725dae390aa3317e2afb9"
        );
        assert_eq!(
            key,
            format!(
                "0x{}",
                hex::encode(ckb_hash::blake2b_256(witness_lock.as_slice()))
            )
        );

        // The declared message reaches the wire without the NUL padding the
        // miner wrapped it in, and with everything between left alone.
        assert_eq!(message.as_deref(), Some("0.209.0 (7e31f75 2026-07-30)"));
    }

    /// ⭐ Genesis is not the "no witness" case the shape of this code would
    /// suggest. Its cellbase carries a perfectly valid `CellbaseWitness` —
    /// whose lock is the null script, because nobody mined genesis. Hashing
    /// that anyway does not yield an obvious zero: it yields a well-formed
    /// 64-hex key that every consumer above would read as a producer
    /// identity, and a devnet starts at genesis every time.
    #[test]
    fn genesis_names_no_producer_even_though_its_witness_parses() {
        let genesis_bytes = hex::decode(GENESIS_WITNESS.trim_start_matches("0x")).unwrap();
        let witness = packed::CellbaseWitness::from_slice(&genesis_bytes)
            .expect("genesis really does carry a valid CellbaseWitness");
        assert_eq!(
            witness.lock().as_slice(),
            packed::Script::default().as_slice(),
            "genesis declares the null script as its miner lock"
        );

        // What a naive read would emit: not a zero, and not obviously wrong.
        let phantom = format!(
            "0x{}",
            hex::encode(witness.lock().calc_script_hash().raw_data())
        );
        assert_eq!(
            phantom,
            "0x77c93b0632b5b6c3ef922c5b7cea208fb0a7c427a13d50e13d3fefad17e0c590"
        );

        let genesis_lock = serde_json::json!({
            "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hash_type": "data",
            "args": "0x",
        });
        let block = cellbase_block_with(
            Some(serde_json::json!([GENESIS_WITNESS])),
            genesis_lock.clone(),
        );
        assert_eq!(
            producer_of(&block),
            (None, None),
            "no synthesized key, no empty-string key — genesis names nobody"
        );

        // And the block itself still translates whole.
        let muts = translate_block(&block, 0, 42, 0).expect("genesis still translates");
        assert!(matches!(muts[0], Mutation::BlockMined { number: 0, .. }));
        assert!(matches!(muts[1], Mutation::TxLanded { block: 0, .. }));
    }

    /// A witness cknerv cannot read is not an error — a block whose producer
    /// is illegible is still a block cknerv must show. Both halves come back
    /// `None` together, since one reading yields both.
    ///
    /// ⚠️ The `WitnessArgs` row is the interesting one. It is a DIFFERENT
    /// molecule from `CellbaseWitness` (three fields against two), and
    /// confusing the two is the historical bug that makes miner messages come
    /// back empty. Here it must simply fail to parse rather than yield
    /// anything at all.
    #[test]
    fn an_unreadable_witness_leaves_the_block_without_a_producer() {
        let witness_args = packed::WitnessArgs::new_builder()
            .lock(Some(ckb_types::bytes::Bytes::from(vec![1u8, 2, 3])).pack())
            .build();
        let witness_args_hex = format!("0x{}", hex::encode(witness_args.as_slice()));

        let cases: Vec<(&str, Option<Value>)> = vec![
            ("no witnesses field at all", None),
            ("an empty witness list", Some(serde_json::json!([]))),
            ("an empty witness", Some(serde_json::json!(["0x"]))),
            (
                "a witness that is not hex",
                Some(serde_json::json!(["0xnothex"])),
            ),
            (
                "a truncated witness",
                Some(serde_json::json!(["0x7f0000000c00000055"])),
            ),
            (
                "a WitnessArgs, which is a different molecule",
                Some(serde_json::json!([witness_args_hex])),
            ),
            (
                "a witness that is not a string",
                Some(serde_json::json!([42])),
            ),
        ];

        for (label, witnesses) in cases {
            let block = cellbase_block_with(
                witnesses,
                sighash_lock_json(BLOCK_20259445_OUTPUT_LOCK_ARGS),
            );
            assert_eq!(
                producer_of(&block),
                (None, None),
                "{label}: an illegible producer is None, never invented"
            );
            let muts = translate_block(&block, 1, 42, 0)
                .unwrap_or_else(|e| panic!("{label}: the block must still translate: {e}"));
            assert_eq!(muts.len(), 2, "{label}: BlockMined + the cellbase TxLanded");
        }
    }

    /// The message is the miner talking, and it arrives as declared apart
    /// from the padding stripped off its ends. A producer that declared
    /// nothing readable says `""` — which is still an answer, and still comes
    /// with a key.
    #[test]
    fn the_declared_message_arrives_trimmed_but_otherwise_verbatim() {
        let cellbase_witness = |message: &[u8]| {
            let witness = packed::CellbaseWitness::new_builder()
                .lock(
                    packed::Script::new_builder()
                        .code_hash(
                            packed::Byte32::from_slice(
                                &hex::decode(SIGHASH_CODE_HASH.trim_start_matches("0x")).unwrap(),
                            )
                            .unwrap(),
                        )
                        .hash_type(packed::Byte::new(1))
                        .args(ckb_types::bytes::Bytes::from(vec![0xab; 20]).pack())
                        .build(),
                )
                .message(ckb_types::bytes::Bytes::from(message.to_vec()).pack())
                .build();
            let block = cellbase_block_with(
                Some(serde_json::json!([format!(
                    "0x{}",
                    hex::encode(witness.as_slice())
                )])),
                sighash_lock_json(BLOCK_20259445_OUTPUT_LOCK_ARGS),
            );
            producer_of(&block)
        };

        let (key, message) = cellbase_witness(b"\0\0\0\0 0.209.0 (d166e28 2026-07-29) bpool\0");
        assert!(key.is_some());
        assert_eq!(
            message.as_deref(),
            Some("0.209.0 (d166e28 2026-07-29) bpool")
        );

        // Nothing declared is not the same as nothing known: the key is still
        // there, and the message is an empty claim rather than a missing one.
        let (key, message) = cellbase_witness(b"");
        assert!(key.is_some());
        assert_eq!(message.as_deref(), Some(""));

        let (_, padding_only) = cellbase_witness(b"\0\0\0\0");
        assert_eq!(padding_only.as_deref(), Some(""));
    }

    #[test]
    fn translate_block_emits_tx_landed_with_cellbase_input() {
        let block = cellbase_block_json(7, "0xblock7");
        let muts = translate_block(&block, 7, 42, 0).expect("translate ok");
        match &muts[1] {
            Mutation::TxLanded {
                block,
                inputs,
                outputs,
                ..
            } => {
                assert_eq!(*block, 7);
                assert_eq!(inputs.len(), 1, "cellbase has its phantom input preserved");
                assert!(
                    cknerv_core::is_cellbase_input(&inputs[0]),
                    "phantom input should be recognized as cellbase"
                );
                assert_eq!(outputs.len(), 1);
                assert_eq!(outputs[0].capacity, 0xae0bc7e000);
                assert!(outputs[0].content_hash.starts_with("0x"));
                assert_eq!(outputs[0].content_hash.len(), 66);
            }
            other => panic!("expected TxLanded second, got {other:?}"),
        }
    }

    #[test]
    fn output_component_seeds_change_only_with_their_source_bytes() {
        let base = parse_output_info(
            &output_json(1_000, &[1, 2], Some(&[3, 4])),
            "0xaabb",
            "base",
        )
        .unwrap();
        assert_eq!(base.data_bytes, 2);
        assert_ne!(base.lock_shape_seed, [0, 0]);
        assert_ne!(base.type_shape_seed, Some([0, 0]));
        assert_ne!(base.data_shape_seed, [0, 0]);

        let lock_changed = parse_output_info(
            &output_json(1_000, &[1, 9], Some(&[3, 4])),
            "0xaabb",
            "lock changed",
        )
        .unwrap();
        assert_ne!(lock_changed.lock_shape_seed, base.lock_shape_seed);
        assert_eq!(lock_changed.type_shape_seed, base.type_shape_seed);
        assert_eq!(lock_changed.data_shape_seed, base.data_shape_seed);

        let type_changed = parse_output_info(
            &output_json(1_000, &[1, 2], Some(&[3, 9])),
            "0xaabb",
            "type changed",
        )
        .unwrap();
        assert_eq!(type_changed.lock_shape_seed, base.lock_shape_seed);
        assert_ne!(type_changed.type_shape_seed, base.type_shape_seed);
        assert_eq!(type_changed.data_shape_seed, base.data_shape_seed);

        let data_changed = parse_output_info(
            &output_json(1_000, &[1, 2], Some(&[3, 4])),
            "0xaabc",
            "data changed",
        )
        .unwrap();
        assert_eq!(data_changed.data_bytes, base.data_bytes);
        assert_eq!(data_changed.lock_shape_seed, base.lock_shape_seed);
        assert_eq!(data_changed.type_shape_seed, base.type_shape_seed);
        assert_ne!(data_changed.data_shape_seed, base.data_shape_seed);

        let capacity_changed = parse_output_info(
            &output_json(2_000, &[1, 2], Some(&[3, 4])),
            "0xaabb",
            "capacity changed",
        )
        .unwrap();
        assert_ne!(capacity_changed.content_hash, base.content_hash);
        assert_eq!(capacity_changed.lock_shape_seed, base.lock_shape_seed);
        assert_eq!(capacity_changed.type_shape_seed, base.type_shape_seed);
        assert_eq!(capacity_changed.data_shape_seed, base.data_shape_seed);

        let no_type =
            parse_output_info(&output_json(1_000, &[1, 2], None), "0x", "plain cell").unwrap();
        assert_eq!(no_type.type_shape_seed, None);
        assert_eq!(no_type.data_bytes, 0);
        assert_eq!(no_type.data_shape_seed, [0x44f4_c697, 0x44d5_f8c5]);
    }

    /// The claim the whole field rests on. `cluster_id` is the LAST molecule
    /// field, after `content`, so any spore with real content hides it behind
    /// the 1,024-byte cap — a client reading `data_hex` could never recover
    /// it. This side reads the untruncated bytes, and the cap is applied
    /// after. A 2 KiB spore proves it: `data_hex` comes back with the
    /// truncation marker, and the collection is there anyway.
    #[test]
    fn a_spores_collection_is_read_before_the_data_hex_cap() {
        /// `SporeData`: `content_type: Bytes, content: Bytes, cluster_id:
        /// BytesOpt`, built the way the chain serializes it.
        fn spore_data(content: &[u8], cluster: Option<&[u8]>) -> String {
            let content_type = b"dob/0";
            let header = 4 + 4 * 3;
            let content_at = header + 4 + content_type.len();
            let cluster_at = content_at + 4 + content.len();
            let full = cluster_at + cluster.map_or(0, |id| 4 + id.len());
            let mut out = Vec::with_capacity(full);
            out.extend_from_slice(&(full as u32).to_le_bytes());
            for offset in [header, content_at, cluster_at] {
                out.extend_from_slice(&(offset as u32).to_le_bytes());
            }
            for field in [content_type.as_slice(), content] {
                out.extend_from_slice(&(field.len() as u32).to_le_bytes());
                out.extend_from_slice(field);
            }
            if let Some(id) = cluster {
                out.extend_from_slice(&(id.len() as u32).to_le_bytes());
                out.extend_from_slice(id);
            }
            format!("0x{}", hex::encode(out))
        }

        // The Nervape cluster, and the spore code hash that classifies as an
        // item — both pinned from mainnet in `shape_seed.rs`.
        let cluster =
            hex::decode("d5852c19fa4fa394d64915cafe026cdeb702ce53cf2b839c6ace501e8dead41c")
                .unwrap();
        let spore_output = serde_json::json!({
            "capacity": "0x84595161401484a",
            "lock": {
                "code_hash": format!("0x{}", hex::encode([0x11u8; 32])),
                "hash_type": "type",
                "args": "0x",
            },
            "type": {
                "code_hash":
                    "0x4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5",
                "hash_type": "data1",
                "args": format!("0x{}", hex::encode([0x04u8; 32])),
            },
        });

        let big = spore_data(&[0xab; 2048], Some(&cluster));
        let parsed = parse_output_info(&spore_output, &big, "big spore").unwrap();
        assert!(
            parsed.data_hex.ends_with(DATA_HEX_TRUNCATION_MARKER),
            "the cap must actually bite for this test to mean anything"
        );
        assert_eq!(parsed.collection_seed, Some([0xc5eb_230e, 0xcdd6_2018]));

        // A small spore reaches the same collection through data the cap
        // never touched — one seed, whether or not the client can see why.
        let small = spore_data(b"{}", Some(&cluster));
        let small = parse_output_info(&spore_output, &small, "small spore").unwrap();
        assert!(!small.data_hex.ends_with(DATA_HEX_TRUNCATION_MARKER));
        assert_eq!(small.collection_seed, parsed.collection_seed);

        // A sole spore, and a plain cell, carry none.
        let sole = spore_data(b"{}", None);
        assert_eq!(
            parse_output_info(&spore_output, &sole, "sole spore")
                .unwrap()
                .collection_seed,
            None
        );
        assert_eq!(
            parse_output_info(&output_json(1_000, &[1, 2], None), "0x", "plain")
                .unwrap()
                .collection_seed,
            None
        );
    }

    #[test]
    fn header_timestamp_ms_parses_hex_and_handles_missing() {
        let block = serde_json::json!({
            "header": { "hash": "0xh", "timestamp": "0x18d6f1c2c00" }
        });
        assert_eq!(header_timestamp_ms(&block), Some(0x18d6f1c2c00));

        let no_ts = serde_json::json!({ "header": { "hash": "0xh" } });
        assert_eq!(header_timestamp_ms(&no_ts), None);
    }

    #[test]
    fn block_time_uses_header_only_for_replay() {
        let block = serde_json::json!({
            "header": { "hash": "0xh", "timestamp": "0x1234" }
        });
        assert_eq!(block_time_ms(&block, BlockTimeSource::Observed, 99), 99);
        assert_eq!(block_time_ms(&block, BlockTimeSource::Header, 99), 0x1234);

        let no_ts = serde_json::json!({ "header": { "hash": "0xh" } });
        assert_eq!(block_time_ms(&no_ts, BlockTimeSource::Header, 99), 99);
    }

    #[test]
    fn truncate_hex_short_passthrough() {
        assert_eq!(truncate_hex("0xdeadbeef", 1024), "0xdeadbeef");
    }

    /// The marker is ASCII on purpose — the columnar encoder's offset table
    /// only survives single-byte characters.
    #[test]
    fn truncate_hex_caps_long_input() {
        let truncated = truncate_hex("0xaabbccddeeff0011", 4);
        assert_eq!(truncated, "0xaabbccdd~");
        assert!(truncated.is_ascii());
    }

    #[test]
    fn serialized_block_size_round_trips_a_real_block() {
        // Build a minimal real block, JSON-encode it the way the node would, and
        // assert the helper recovers the canonical packed size.
        let block = ckb_types::core::BlockBuilder::default().build();
        let expected = block.data().as_slice().len() as u64;
        let json =
            serde_json::to_value(ckb_jsonrpc_types::BlockView::from(block)).expect("to json");
        assert_eq!(serialized_block_size(&json), expected);
    }

    #[test]
    fn serialized_block_size_is_zero_on_garbage() {
        assert_eq!(serialized_block_size(&serde_json::json!({})), 0);
    }

    #[test]
    fn translate_block_bails_on_missing_capacity() {
        let mut block = cellbase_block_json(1, "0xb");
        block["transactions"][0]["outputs"][0]
            .as_object_mut()
            .unwrap()
            .remove("capacity");
        let err = translate_block(&block, 1, 0, 0).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("capacity"),
            "expected error mentioning capacity, got: {msg}"
        );
    }
}
