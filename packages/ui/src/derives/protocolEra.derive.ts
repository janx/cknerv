import type {
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEra,
  ProtocolEraRecord,
} from '@cknerv/types';

export type ProtocolEraVisualState = 'ready' | 'stale';

export const PROTOCOL_ERA_STALE_AFTER_MS = 15 * 60 * 1_000;
export const PROTOCOL_ERA_MAX_LABEL_CHARS = 64;

export interface ProtocolEraVisual {
  current: ProtocolEra | null;
  upcoming: ProtocolEra | null;
  label: string;
  title: string;
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalNetwork(chainName: string): string | null {
  if (chainName === 'ckb') return 'mainnet';
  if (chainName === 'ckb_testnet') return 'testnet';
  return null;
}

function validName(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && [...value].length <= PROTOCOL_ERA_MAX_LABEL_CHARS
    && !/\p{Cc}/u.test(value);
}

function validEra(era: ProtocolEra): boolean {
  return validName(era.name)
    && Number.isSafeInteger(era.edition_year)
    && era.edition_year > 0
    && era.edition_year <= 0xffff
    && safeNonnegativeInteger(era.activation_epoch)
    && (era.activation_block === undefined
      || safeNonnegativeInteger(era.activation_block));
}

/** Suppress protocol context whose optional source or proof is unusable. */
export function protocolEraVisualState(
  source: EnrichmentSourceStatus,
  record: ProtocolEraRecord,
  nowMs = Date.now(),
): ProtocolEraVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (!source.capabilities.includes('protocol_era')) return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor
    || !safeNonnegativeInteger(anchor.block)
    || !safeNonnegativeInteger(record.as_of.block)
    || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!safeNonnegativeInteger(record.updated_at_ms)) return null;
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > PROTOCOL_ERA_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

/** ⚠️ `NAME YEAR`, and the separator is the whole point. This label was
 *  `MEEPO·24`, which is the HUD's ONE address grammar — `CKB·01`, `PEER·02`,
 *  `ECG·04`, `SCAN·02` — worn by a fact about the chain, two rows under
 *  `CKB·01` itself. Nothing on screen says the 24 is a year, and a reader the
 *  codes have trained will parse it as module 24 (report A, A-6). The era is a
 *  NAME and a YEAR, so it is written the way a name and a year are written;
 *  the year is printed in full because a two-digit year beside four-digit
 *  block heights is the ambiguity all over again. */
function editionLabel(era: ProtocolEra): string {
  return `${era.name.toLocaleUpperCase('en-US')} ${era.edition_year}`;
}

function activationLabel(era: ProtocolEra): string {
  const block = era.activation_block === undefined
    ? ''
    : `, block #${era.activation_block.toLocaleString('en-US')}`;
  return `${era.name} ${era.edition_year}: epoch ${era.activation_epoch.toLocaleString('en-US')}${block}`;
}

/** Validate and reduce indexed edition data before rendering one compact badge. */
export function deriveProtocolEraVisual(
  record: ProtocolEraRecord,
  chain: Pick<ChainEntry, 'chain_name' | 'epoch'>,
): ProtocolEraVisual | null {
  const network = canonicalNetwork(chain.chain_name);
  if (!network || record.network !== network) return null;
  if (!safeNonnegativeInteger(chain.epoch.number)
    || !safeNonnegativeInteger(record.as_of.block)
    || !safeNonnegativeInteger(record.indexed_tip_block)
    || !safeNonnegativeInteger(record.indexed_tip_epoch)
    || record.indexed_tip_block > record.as_of.block
    || record.indexed_tip_epoch > chain.epoch.number) return null;

  const current = record.current ?? null;
  const upcoming = record.upcoming ?? null;
  if (!current && !upcoming) return null;
  if (current && (
    !validEra(current)
    || current.activation_epoch > record.indexed_tip_epoch
    || (current.activation_block !== undefined
      && current.activation_block > record.indexed_tip_block)
  )) return null;
  if (upcoming && (!validEra(upcoming)
    || upcoming.activation_epoch <= record.indexed_tip_epoch
    || upcoming.activation_block !== undefined)) return null;
  if (current && upcoming
    && current.activation_epoch >= upcoming.activation_epoch) return null;

  const label = current
    ? editionLabel(current)
    : `PRE-${editionLabel(upcoming!)}`;
  const era = current
    ? `Current protocol edition ${activationLabel(current)}`
    : `No protocol edition activated; next ${activationLabel(upcoming!)}`;
  const next = current && upcoming ? `; next ${activationLabel(upcoming)}` : '';
  const title = `${era}${next}; validated through epoch ${record.indexed_tip_epoch.toLocaleString('en-US')}, block #${record.indexed_tip_block.toLocaleString('en-US')}`;
  return { current, upcoming, label, title };
}
