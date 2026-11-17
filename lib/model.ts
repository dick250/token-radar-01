// Token Launch Radar — the valuation model (version anchor-2).
//
// One sealed snapshot in, one ranked board out. Every number on the board is derived from the
// snapshot's own ten fields; no protocol is ever named in this file. The model in one line:
//
//   implied_value = FDV_est x airdrop_share x p_launch x momentum x survival
//
// FDV_est (what the token might be worth at launch):
//   Protocols that already trade publish a market cap next to their TVL. Within each category the
//   ratio mcap / TVL says how the market prices a dollar of locked value for that kind of protocol
//   today (a DEX's TVL is priced near 0.34x, a lender's near 0.13x, a liquid-staking product's near
//   0.04x). A pre-token protocol is anchored to its own category: FDV_est = TVL x category ratio.
//   Ratios are winsorised to [0.02, 4] before the median. A ratio is a multiplicative thing — one
//   kind of protocol can price at thirty times another — so each median is shrunk toward the
//   snapshot-wide median on a log scale, and the prior's weight falls as the evidence grows: the
//   global median counts as 8/n^2 pseudo-samples against a category's n live peers, so one traded
//   peer is outweighed eight to one, three peers outweigh the prior, and eleven speak for
//   themselves. Two of DefiLlama's labels are one business wearing two names — Risk Curators and
//   Onchain Capital Allocators both allocate other people's capital into lending markets for a
//   fee — so they are estimated as a single family, for the ratio and the launch share alike.
//   The family's traded members price locked value at about two cents on the dollar; by its own
//   label alone, the one traded "Risk Curator" (an oracle token at 2.98x) would have priced
//   $2.8B of client money like a token launch. The family's anchor says otherwise.
//
// airdrop_share (the slice of that value a launch typically hands to early users):
//   A stated prior per category, from how launches of that kind usually allocate supply to the
//   community and points holders: chains and exchanges of value (DEXs, derivatives) run points
//   programs that pay out a tenth or more; yield plumbing and RWA issuers pay less. It is a
//   parameter of the method, printed on the dashboard, never a per-protocol judgement.
//
// p_launch (the chance a protocol like this ever issues a token at all):
//   p = clamp(0.18 + 0.35 x category_launch_share + 0.25 x scale + 0.20 x age_share, 0.10, 0.85)
//   category_launch_share is the share of the category's protocols that already trade, shrunk
//   toward the snapshot-wide share: kinds of protocols that usually launch are likelier to launch.
//   scale = min(1, log10(TVL / 5,000,000) / 3): a billion-dollar protocol has the treasury and the
//   user base to launch; a five-million one mostly does not. age_share = min(1, age_days / 1095):
//   three tokenless years is a track record, three tokenless weeks is not.
//
// momentum = 1 + clamp(change_7d, -40, 80) / 100 x 0.5, in [0.80, 1.40]; unreported growth is 1.0.
//   A protocol gathering TVL into a launch window is worth more than the same TVL draining away.
//
// survival = 0.85 + 0.15 x age_share. Operating for years with no token means real users stayed
//   for the product; that depth is what an airdrop would be buying, so it firms the anchor up.
//
// The board ranks pre-token protocols only. Protocols whose token already trades are carried
// separately (the live set) at the market's own market cap, never mixed into the ranking: the
// radar's job is the launches that have not happened yet.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'anchor-2';

/** Rows on the board: the 40 watchlist slugs plus the strongest early finds below the floor. */
export const BOARD_ROWS = 220;

/** Live-token protocols carried beside the board for the dashboard's separate live view. */
export const LIVE_ROWS = 30;

const DAY_MS = 86_400_000;
/** Age assumed when DefiLlama records no listing date: one year, the middle of the road. */
const UNKNOWN_AGE_DAYS = 365;
/** Three years tokenless is a full track record; the age terms saturate there. */
const AGE_SATURATION_DAYS = 1095;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The house keeps wrapped, staked and bridged products of already-trading tokens off its watchlist
// because their parent protocol field says so; the snapshot does not carry that field, so the board
// applies the same idea with the fields it does carry: a category that is by construction a claim
// on a live asset, a name carrying the whole word wrapped, staked or staking, a version marker, or
// an exchange's own product name. A genuine bridge protocol pays for this approximation; it is the
// honest limit of ten fields, and the dashboard's method note says so.
const WRAPPER_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Restaked BTC', 'Stablecoin Wrapper']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token and not a wrapper of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name)) return false;
  return !EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** What the snapshot's live-token protocols teach, per category and overall. */
export interface CategoryStats {
  /** mcap / TVL anchor: winsorised, medianed over the estimation family, log-shrunk to global. */
  ratio: number;
  /** Live protocols behind the anchor (0 when the family has none with both figures). */
  ratio_samples: number;
  /** Share of the family's protocols that already trade, shrunk toward the snapshot's share. */
  launch_share: number;
  /** The estimation family's name when this category is estimated as part of one, else null. */
  family: string | null;
}

export interface MarketStats {
  global_ratio: number;
  global_launch_share: number;
  by_category: Map<string, CategoryStats>;
}

const RATIO_LO = 0.02;
const RATIO_HI = 4;
const SHARE_SHRINK = 8;

/**
 * Categories that are one business wearing two of DefiLlama's labels, estimated as a single
 * family: risk curators and onchain capital allocators both allocate other people's capital
 * into lending markets for a fee share, and the market prices them alike — every traded member
 * of the family sits near two cents of market cap per TVL dollar, while the family's one
 * remaining label-mate is an oracle token at 2.98x. Keyed by category, valued by family name.
 */
const RATIO_FAMILY: ReadonlyMap<string, string> = new Map([
  ['Risk Curators', 'Capital Allocators'],
  ['Onchain Capital Allocator', 'Capital Allocators'],
]);

/** The estimation family a category is scored with: its family's name, or the category itself. */
function familyOf(category: string): string {
  return RATIO_FAMILY.get(category) ?? category;
}

/**
 * How much the snapshot-wide median counts for, in pseudo-samples, against a family's own n
 * live samples: 8/n^2. One traded peer is nearly no evidence, so the prior outweighs it eight
 * to one; three peers are real evidence and outweigh the prior; eleven need no help at all.
 */
function ratioPriorWeight(samples: number): number {
  return 8 / (samples * samples);
}

/** Derive every market statistic the model uses from the snapshot alone. */
export function marketStats(snapshot: Snapshot): MarketStats {
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const globalLaunchShare = live.length / Math.max(1, snapshot.protocols.length);
  const allRatios: number[] = [];
  const ratiosByFam = new Map<string, number[]>();
  const countsByFam = new Map<string, { live: number; total: number }>();
  const categories = new Set<string>();
  for (const p of snapshot.protocols) {
    const cat = p.category ?? '';
    categories.add(cat);
    const fam = familyOf(cat);
    const counts = countsByFam.get(fam) ?? { live: 0, total: 0 };
    counts.total += 1;
    if (!isPreToken(p)) counts.live += 1;
    countsByFam.set(fam, counts);
    if (!isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const r = clamp(p.mcap_usd / p.tvl_usd, RATIO_LO, RATIO_HI);
      allRatios.push(r);
      const list = ratiosByFam.get(fam) ?? [];
      list.push(r);
      ratiosByFam.set(fam, list);
    }
  }
  const globalRatio = median(allRatios) ?? 0.2;
  const byCategory = new Map<string, CategoryStats>();
  for (const cat of categories) {
    const fam = familyOf(cat);
    const counts = countsByFam.get(fam) ?? { live: 0, total: 0 };
    const samples = ratiosByFam.get(fam) ?? [];
    const med = median(samples);
    // Ratios are multiplicative — a category can price at thirty times another — so the shrink
    // averages logarithms, not ratios: the family's own median and the snapshot-wide median are
    // blended as a weighted geometric mean, weighted by how much evidence the family carries.
    const prior = ratioPriorWeight(Math.max(1, samples.length));
    const ratio =
      med === null
        ? globalRatio
        : Math.exp((samples.length * Math.log(med) + prior * Math.log(globalRatio)) / (samples.length + prior));
    const launchShare = (counts.live + SHARE_SHRINK * globalLaunchShare) / (counts.total + SHARE_SHRINK);
    byCategory.set(cat, {
      ratio,
      ratio_samples: samples.length,
      launch_share: launchShare,
      family: RATIO_FAMILY.get(cat) ?? null,
    });
  }
  return { global_ratio: globalRatio, global_launch_share: globalLaunchShare, by_category: byCategory };
}

/** The airdrop-share prior for a category: how much of a launch's value early users typically get. */
export function airdropShare(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c === 'chain') return 0.15;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return 0.12;
  if (c.includes('lend') || c.includes('cdp') || c.includes('yield')) return 0.1;
  if (c.includes('staking') || c.includes('restak') || c.includes('bridge')) return 0.08;
  if (c.includes('rwa')) return 0.06;
  return 0.09;
}

/** The model's full working for one protocol, kept on the row so the page can show its sums. */
export interface ValueBreakdown {
  fdv_estimate_usd: number;
  category_ratio: number;
  ratio_samples: number;
  anchor_family: string | null;
  airdrop_share: number;
  launch_probability: number;
  momentum_multiplier: number;
  survival_multiplier: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Score one pre-token protocol under the model. */
export function valueOf(p: SnapshotProtocol, asOf: string, stats: MarketStats): ValueBreakdown {
  const cat = stats.by_category.get(p.category ?? '') ?? {
    ratio: stats.global_ratio,
    ratio_samples: 0,
    launch_share: stats.global_launch_share,
    family: null,
  };
  const age = ageDays(asOf, p.listed_at);
  const ageShare = Math.min(1, (age ?? UNKNOWN_AGE_DAYS) / AGE_SATURATION_DAYS);
  const scale = clamp(Math.log10(Math.max(1, p.tvl_usd) / 5_000_000) / 3, 0, 1);
  const launchProbability = clamp(0.18 + 0.35 * cat.launch_share + 0.25 * scale + 0.2 * ageShare, 0.1, 0.85);
  const growth = clamp(finite(p.change_7d, 0), -40, 80);
  const momentum = p.change_7d === null ? 1 : 1 + (growth / 100) * 0.5;
  const survival = 0.85 + 0.15 * ageShare;
  const fdv = p.tvl_usd * cat.ratio;
  const share = airdropShare(p.category);
  const implied = Math.max(1, Math.round(fdv * share * launchProbability * momentum * survival));
  return {
    fdv_estimate_usd: Math.round(fdv),
    category_ratio: round4(cat.ratio),
    ratio_samples: cat.ratio_samples,
    anchor_family: cat.family,
    airdrop_share: share,
    launch_probability: round4(launchProbability),
    momentum_multiplier: round4(momentum),
    survival_multiplier: round4(survival),
    age_days: age,
    implied_value_usd: implied,
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is six steps built from the protocol's own record:
// its category picks the actions, its first chain sets the gas level, its
// TVL sets the position size, its age sets the holding window. Every step
// states what it costs and how long it takes, in the step's own sentence.
// ---------------------------------------------------------------------------

/** Capital for one farm position, from the protocol's own TVL: bigger protocols absorb more. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** Weekly gas for the cadence step: mainnet-priced when the first chain is Ethereum, cheap else. */
function weeklyGasFor(p: SnapshotProtocol): string {
  return p.chains[0] === 'Ethereum' ? 'about $6 of Ethereum gas a week' : 'about $1 of gas a week';
}

/** How long to hold, from the protocol's age: younger protocols need the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

interface CategoryActions {
  core: (p: SnapshotProtocol, capital: number, chain: string) => string;
  second: (p: SnapshotProtocol, capital: number, chain: string) => string;
}

const byCategory = (test: (c: string) => boolean): (c: string) => boolean => test;

const CATEGORY_ACTIONS: { match: (c: string) => boolean; actions: CategoryActions }[] = [
  {
    match: byCategory((c) => c.includes('lend')),
    actions: {
      core: (p, capital, chain) => `Supply $${capital} of USDC to ${p.name} on ${chain} so the wallet starts earning the supply side of the book.`,
      second: (p, capital) => `Borrow $${Math.round(capital / 3)} of a second stablecoin against the position and re-supply it once, so the wallet shows both sides of ${p.name}'s market.`,
    },
  },
  {
    match: byCategory((c) => c.includes('cdp')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} of collateral into a ${p.name} vault on ${chain} and mint a small amount of its stablecoin against it.`,
      second: (p) => `Hold the minted stablecoin in the same wallet and repay a slice of the debt once, so ${p.name} records a full mint-and-repay cycle.`,
    },
  },
  {
    // Before the DEX entry: "indexes" contains "dex", and an index mint is not a liquidity pool.
    match: byCategory((c) => c.includes('index')),
    actions: {
      core: (p, capital, chain) => `Buy about $${capital} of ${p.name}'s flagship index token on ${chain} through its own mint rather than a secondary swap, and hold the index position in the wallet.`,
      second: (p) => `Add a second, smaller mint a week later and redeem nothing, so ${p.name} records a holder adding across two of its rebalances.`,
    },
  },
  {
    match: byCategory((c) => c.includes('dex') || c.includes('liquidity')),
    actions: {
      core: (p, capital, chain) => `Add $${capital} of liquidity to ${p.name}'s busiest stablecoin pool on ${chain} and keep the LP position open.`,
      second: (p, capital) => `Route about $${Math.round(capital / 5)} of swaps a week through ${p.name} from the same wallet, spread over several days rather than one burst.`,
    },
  },
  {
    match: byCategory((c) => c.includes('derivative') || c.includes('perpetual')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} of USDC as margin on ${p.name} (${chain}) and open one small hedged position you can leave running.`,
      second: (p) => `Place and cancel limit orders near the mark price a few times a week so ${p.name} sees order-book activity, not just one deposit.`,
    },
  },
  {
    match: byCategory((c) => c.includes('staking') || c.includes('restak')),
    actions: {
      core: (p, capital, chain) => `Stake $${capital} of the chain's staking asset through ${p.name} on ${chain} and keep the receipt token in the wallet.`,
      second: (p) => `Use the receipt token once inside ${p.name}'s own app (as collateral or in its paired pool) so the position counts as active, not parked.`,
    },
  },
  {
    match: byCategory((c) => c.includes('yield') || c.includes('curator') || c.includes('allocator')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} into one of ${p.name}'s vaults on ${chain} and keep the vault shares untouched.`,
      second: (p, capital) => `Split a second $${Math.round(capital / 2)} across a different ${p.name} vault or curator strategy, so the wallet is not riding on a single allocation.`,
    },
  },
  {
    match: byCategory((c) => c.includes('rwa')),
    actions: {
      core: (p, capital, chain) => `Mint $${capital} of ${p.name}'s yield-bearing asset on ${chain} after its onboarding check, and hold the asset in the wallet.`,
      second: (p) => `Redeem a small slice (about a tenth) once and mint it back, so ${p.name} records a complete mint-redeem cycle for the wallet.`,
    },
  },
  {
    match: byCategory((c) => c.includes('prediction')),
    actions: {
      core: (p, capital) => `Fund the wallet with $${capital} on ${p.name} and take one position in a liquid market you actually have a view on.`,
      second: (p) => `Settle or roll each position before it expires and keep a steady weekly rhythm of trades on ${p.name} rather than one large bet.`,
    },
  },
  {
    match: byCategory((c) => c.includes('chain')),
    actions: {
      core: (p, capital, chain) => `Bridge $${capital} onto ${chain} and hold it there; a chain's future token rewards wallets that keep funds and activity on it.`,
      second: (p) => `Use two or three of the chain's native apps from the same wallet each week (a swap, a lend, a mint) so the wallet reads as a resident, not a tourist.`,
    },
  },
  {
    match: byCategory((c) => c.includes('basis')),
    actions: {
      core: (p, capital, chain) => `Open the basis trade ${p.name} runs on ${chain}: deposit $${capital} of USDC, take the spot leg it specifies and the offsetting short it pairs with it, so the wallet holds a live basis position.`,
      second: (p) => `Roll or resize the position once when the funding window resets, and log the funding rate ${p.name} paid over the first week, so the wallet's history shows a managed basis book, not a parked deposit.`,
    },
  },
  {
    match: byCategory((c) => c.includes('leveraged')),
    actions: {
      core: (p, capital, chain) => `Supply $${capital} of collateral to ${p.name} on ${chain}, borrow against it at the conservative loop it offers by default, and re-supply the borrowed asset once to open the leveraged position.`,
      second: (p) => `Set the health-factor alert ${p.name} offers and top the collateral up once with a small second deposit, so the wallet records active risk management of the loop rather than set-and-forget leverage.`,
    },
  },
  {
    match: byCategory((c) => c === 'farm'),
    actions: {
      core: (p, capital, chain) => `Stake $${capital} into ${p.name}'s featured farm pool on ${chain} and leave the stake untouched, so it accrues the pool's points or emissions from the first day.`,
      second: (p) => `Harvest the accrued rewards once and restake them into the same pool, so ${p.name} records a claim-and-compound cycle from the wallet instead of a single deposit.`,
    },
  },
  {
    match: byCategory((c) => c.includes('cedefi')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} of USDC into ${p.name}'s managed yield account on ${chain} after its onboarding step, and keep the balance above its stated minimum for the whole window.`,
      second: (p) => `Make one small second deposit a week later and download the account statement ${p.name} issues, so the wallet shows a returning customer with a paper trail, not a one-off balance.`,
    },
  },
  {
    match: byCategory((c) => c.includes('btc')),
    actions: {
      core: (p, capital, chain) => `Move $${capital} of BTC (or its wrapped form on ${chain}) into ${p.name} and mint or stake it into the position it offers, keeping the receipt token in the same wallet.`,
      second: (p) => `Add a small second tranche of BTC a week later and check the backing figure ${p.name} publishes, so the wallet's history spans more than one of its attestations.`,
    },
  },
  {
    match: byCategory((c) => c.includes('stablecoin')),
    actions: {
      core: (p, capital, chain) => `Mint $${capital} of ${p.name}'s stablecoin against its accepted collateral on ${chain}, and hold both the stablecoin and the position backing it in the wallet.`,
      second: (p) => `Stake the minted stablecoin in ${p.name}'s own savings or stability module if it offers one, and redeem a small slice once, so the wallet records the full mint-stake-redeem cycle.`,
    },
  },
  {
    match: byCategory((c) => c.includes('collateral')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} of an accepted collateral asset into ${p.name} on ${chain} and register it in the collateral pool it routes to vaults and markets.`,
      second: (p) => `Move a slice of the collateral between two of ${p.name}'s listed markets once, so the wallet shows the collateral actually working in more than one venue.`,
    },
  },
  {
    match: byCategory((c) => c.includes('otc')),
    actions: {
      core: (p, capital) => `Complete ${p.name}'s trader onboarding, then place one small OTC order (about $${capital}) for a listed asset and let it settle through the desk.`,
      second: (p) => `Request two or three quotes on different days before settling a second, smaller trade, so ${p.name} sees a price-checking counterparty rather than a single accidental order.`,
    },
  },
  {
    match: byCategory((c) => c.includes('insurance')),
    actions: {
      core: (p, capital, chain) => `Buy one cover policy from ${p.name} on ${chain} for about $${capital} of cover on a position you actually hold, and keep the policy active for its full term.`,
      second: (p) => `Renew or extend the cover once before it lapses, so ${p.name} records a returning policyholder rather than a one-off purchase that expired untouched.`,
    },
  },
  {
    match: byCategory((c) => c.includes('payment')),
    actions: {
      core: (p, capital, chain) => `Route one real payment of about $${capital} through ${p.name} on ${chain} — pay an invoice or a person you owe — instead of your usual rail, and keep the receipt.`,
      second: (p) => `Make payments through ${p.name} on three separate weeks, varying the amount each time, so the wallet builds the steady transaction history payment networks reward.`,
    },
  },
  {
    match: byCategory((c) => c.includes('options')),
    actions: {
      core: (p, capital, chain) => `Deposit $${capital} of USDC into one of ${p.name}'s options vaults on ${chain} before its weekly epoch closes, and keep the vault shares for a full epoch.`,
      second: (p) => `Stay in the vault for a second epoch, or roll into its paired vault once, so the wallet's history covers more than one options expiry cycle.`,
    },
  },
  {
    match: byCategory((c) => c.includes('governance')),
    actions: {
      core: (p, capital, chain) => `Take the qualifying position ${p.name} rewards on ${chain} (about $${capital} of the asset it names) and register the wallet in its incentives program.`,
      second: (p) => `Vote or claim through ${p.name}'s program once in the following round, so the wallet appears in two separate incentive rounds, not just the first snapshot.`,
    },
  },
  {
    match: byCategory((c) => c.includes('card')),
    actions: {
      core: (p, capital) => `Order ${p.name}'s card after its identity check, load it with about $${capital}, and make the first card purchase so the account is live.`,
      second: (p) => `Use the card for three ordinary purchases across two weeks and keep the balance topped up, so ${p.name} sees a spending customer, not a card ordered and shelved.`,
    },
  },
];

const DEFAULT_ACTIONS: CategoryActions = {
  core: (p, capital, chain) => `Deposit $${capital} of USDC into ${p.name} on ${chain} through its own app and keep the position open.`,
  second: (p) => `Make one more qualifying action inside ${p.name} (a second deposit, a vote or a claim check) so the wallet's history is more than a single transaction.`,
};

function actionsFor(p: SnapshotProtocol): CategoryActions {
  const c = (p.category ?? '').toLowerCase();
  return CATEGORY_ACTIONS.find((entry) => entry.match(c))?.actions ?? DEFAULT_ACTIONS;
}

/** Force a step string into the gate's 20..600 trimmed characters without cutting a word in half. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596).replace(/\s+\S*$/, '')}...`;
  if (s.length < 20) s = `${s} Keep the position open and log it.`;
  return s;
}

/** A protocol's farm plan: six concrete steps, each with its cost and its time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const chainNote = p.chains.length > 1 ? ` (it runs on ${p.chains.length} chains; start where its TVL sits deepest)` : '';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const actions = actionsFor(p);
  const raw: [string, string, string][] = [
    [
      `Set up a fresh wallet for ${p.name} alone, fund it from your main wallet, and keep the seed phrase offline on paper.`,
      'under $3 of gas for the funding transaction',
      '10 minutes',
    ],
    [`${actions.core(p, capital, chain)}${chainNote}`, `$${capital} of capital plus about $4 of gas`, '20 minutes to set up'],
    [actions.second(p, capital, chain), 'the gas of two or three small transactions, about $3 in total', '15 minutes'],
    [
      `Repeat one qualifying action on ${p.name} every week (a deposit top-up, a swap, a vote or a claim check) so the wallet never looks like a one-day visitor.`,
      weeklyGasFor(p),
      '10 minutes a week',
    ],
    [
      `Hold the position for at least ${hold} days before withdrawing anything, so the activity spans more than one of the protocol's own snapshots.`,
      `the $${capital} stays in the position for the whole window`,
      `${hold} days`,
    ],
    [
      `Keep a farm log (wallet, dates, amounts, transaction hashes) and set an exit rule now: if ${p.name}'s TVL falls by a third in a week, withdraw half first and ask questions after.`,
      'nothing but the log itself',
      '5 minutes a week',
    ],
  ];
  return raw.map(([text, cost, time]) => stepText(text, cost, time));
}

// ---------------------------------------------------------------------------
// The board.
// ---------------------------------------------------------------------------

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  fdv_estimate_usd: number;
  category_ratio: number;
  ratio_samples: number;
  anchor_family: string | null;
  airdrop_share: number;
  launch_probability: number;
  momentum_multiplier: number;
  survival_multiplier: number;
  age_days: number | null;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_summary: string;
  global_ratio: number;
  global_launch_share: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The board: every watchlist slug, plus the strongest early finds, ranked by implied value. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = marketStats(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, v: valueOf(p, snapshot.as_of, stats) }))
    .sort((a, b) => b.v.implied_value_usd - a.v.implied_value_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  const scored = [...chosen.values()].map((p) => ({ p, v: valueOf(p, snapshot.as_of, stats) }));
  for (const e of early) scored.push(e);
  scored.sort((a, b) => b.v.implied_value_usd - a.v.implied_value_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.v.implied_value_usd,
    fdv_estimate_usd: s.v.fdv_estimate_usd,
    category_ratio: s.v.category_ratio,
    ratio_samples: s.v.ratio_samples,
    anchor_family: s.v.anchor_family,
    airdrop_share: s.v.airdrop_share,
    launch_probability: s.v.launch_probability,
    momentum_multiplier: s.v.momentum_multiplier,
    survival_multiplier: s.v.survival_multiplier,
    age_days: s.v.age_days,
    farm_steps: farmSteps(s.p, s.v.age_days),
  }));
}

/** The live set: already-trading protocols at the market's own values, kept off the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Build the board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const stats = marketStats(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_summary:
      'Implied value = FDV estimate x airdrop share x launch probability x momentum x survival. ' +
      'The FDV estimate anchors each pre-token protocol to the market-cap-to-TVL ratio of the live protocols in its own category; ' +
      'categories with the same economics are estimated as one family, and every anchor is shrunk toward the snapshot median on a log scale, ' +
      'by an amount that falls as the family gains traded peers.',
    global_ratio: round4(stats.global_ratio),
    global_launch_share: round4(stats.global_launch_share),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script beside the page: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
