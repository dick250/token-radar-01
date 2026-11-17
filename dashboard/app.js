// Token Launch Radar — the page. Renders window.RADAR (written beside this page by main.ts)
// three ways: the ranked pre-token board, one protocol's detail view, and the live set of
// protocols whose token already trades. No fetch, no network: every byte came with the page.
'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const main = document.getElementById('main');

const money = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const pct = (n) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const ageText = (d) => {
  if (d === null) return 'unknown';
  if (d >= 730) return `${(d / 365).toFixed(1)}y`;
  if (d >= 60) return `${Math.round(d / 30)}mo`;
  return `${d}d`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const chainsText = (chains) => (chains.length === 0 ? '—' : chains.length <= 2 ? chains.join(', ') : `${chains[0]}, ${chains[1]} +${chains.length - 2}`);

// Masthead figures and the footer line: the snapshot's own counts, nothing invented.
document.getElementById('mastStats').innerHTML = [
  [String(R.board_size), 'ranked pre-token'],
  [`${R.watchlist_size}/${R.watchlist_size}`, 'watchlist covered'],
  [String(R.pre_token_size), 'pre-token scanned'],
  [R.as_of, 'snapshot date'],
]
  .map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`)
  .join('');
document.getElementById('footNote').textContent =
  `Data: ${R.source}. Model ${R.model_version}: category anchor median ${R.global_ratio}x TVL snapshot-wide; ` +
  `${R.early_size} of the ${R.board_size} rows sit below the ${money(R.floor_usd)} watchlist floor — the early finds are the point of a radar.`;

// Filter options come from the board itself.
const catSel = document.getElementById('cat');
for (const c of [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort()) {
  catSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`);
}
const chainSel = document.getElementById('chain');
for (const c of [...new Set(rows.flatMap((r) => r.chains))].sort()) {
  chainSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`);
}

const state = { view: 'board', q: '', cat: '', chain: '', watchOnly: false, sort: 'implied' };

function visibleRows() {
  let out = rows.filter((r) => {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.q && !`${r.name} ${r.slug}`.toLowerCase().includes(state.q)) return false;
    return true;
  });
  const key = {
    implied: (r) => r.implied_value_usd,
    tvl: (r) => r.tvl_usd,
    change: (r) => (r.change_7d === null ? -1e9 : r.change_7d),
    age: (r) => (r.age_days === null ? -1 : r.age_days),
  }[state.sort];
  out = out.sort((a, b) => key(b) - key(a) || a.rank - b.rank);
  return out;
}

function boardHTML() {
  const vis = visibleRows();
  if (vis.length === 0) return `<p class="empty">No protocol on the board matches those filters.</p>`;
  const topImplied = rows[0].implied_value_usd;
  const body = vis
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}">
        <td class="rank">${r.rank}</td>
        <td><span class="name">${esc(r.name)}</span>${r.watchlist ? '<span class="chip watch">WATCHLIST</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
        <td><span class="chip cat">${esc(r.category || 'Uncategorised')}</span></td>
        <td>${esc(chainsText(r.chains))}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num">${r.category_ratio}x</td>
        <td class="num">${money(r.fdv_estimate_usd)}</td>
        <td class="num implied"><span class="ival"><i style="width:${Math.max(3, Math.round(92 * Math.sqrt(r.implied_value_usd / topImplied)))}px"></i>${money(r.implied_value_usd)}</span></td>
      </tr>`,
    )
    .join('');
  return `<p class="count">${vis.length} of ${rows.length} ranked protocols shown. Click any row for its model breakdown and farm plan.</p>
    <table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Tokenless</th><th class="num">Anchor</th><th class="num">FDV est.</th><th class="num">Implied value</th></tr></thead><tbody>${body}</tbody></table>`;
}

function liveHTML() {
  const body = R.live
    .map(
      (r) => `<tr data-live="${esc(r.slug)}">
        <td><span class="name">${esc(r.name)}</span><br><span class="slug">${esc(r.slug)}</span></td>
        <td><span class="chip cat">${esc(r.category || 'Uncategorised')}</span></td>
        <td>${esc(chainsText(r.chains))}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${money(r.mcap_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
      </tr>`,
    )
    .join('');
  return `<p class="count">These protocols already trade, so they are not ranked: the market has priced them. They are shown at its own market cap — and they are the peers whose market-cap-to-TVL ratios anchor the board's FDV estimates.</p>
    <table><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>${body}</tbody></table>`;
}

function factor(label, value, why, barShare) {
  const bar = barShare === undefined ? '' : `<div class="bar"><i style="width:${Math.round(barShare * 100)}%"></i></div>`;
  return `<div class="factor"><div>${label}<span class="why">${why}</span>${bar}</div><div class="v">${value}</div></div>`;
}

function detailHTML(r) {
  const steps = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<button class="back" id="backBtn" type="button">&larr; Back to the board</button>
  <div class="detail-head">
    <h2>${esc(r.name)}</h2>
    <span class="chip cat">${esc(r.category || 'Uncategorised')}</span>
    ${r.watchlist ? '<span class="chip watch">ON THE HOUSE WATCHLIST</span>' : '<span class="chip cat">EARLY FIND — BELOW THE WATCHLIST FLOOR</span>'}
  </div>
  <p class="count">${esc(r.slug)} · rank #${r.rank} of ${rows.length} · records no token in the snapshot${r.listed_at ? ` · tracked since ${esc(r.listed_at)}` : ''}</p>
  <div class="cards">
    <div class="card"><b>${money(r.implied_value_usd)}</b><span>Implied value</span></div>
    <div class="card"><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
    <div class="card"><b>${pct(r.change_7d)}</b><span>TVL change, 7d</span></div>
    <div class="card"><b>${ageText(r.age_days)}</b><span>Run with no token</span></div>
    <div class="card"><b>${money(r.fdv_estimate_usd)}</b><span>FDV estimate</span></div>
    <div class="card"><b>${esc(chainsText(r.chains))}</b><span>Chains</span></div>
  </div>
  <div class="split">
    <section class="panel"><h3>How the model prices it</h3>
      ${factor('Category anchor', `${r.category_ratio}x TVL`, r.anchor_family
        ? `median market-cap-to-TVL of ${r.ratio_samples} live peers across the ${esc(r.anchor_family)} family — two labels, one business, estimated together — shrunk on a log scale toward the snapshot median`
        : `median market-cap-to-TVL of ${r.ratio_samples} live peers in ${esc(r.category || 'its category')}, shrunk on a log scale toward the snapshot median`)}
      ${factor('FDV estimate', money(r.fdv_estimate_usd), 'TVL priced the way the market prices its live peers')}
      ${factor('Airdrop share', `${Math.round(r.airdrop_share * 100)}%`, `the prior for ${esc(r.category || 'this kind of')} launches: the slice early users typically receive`)}
      ${factor('Launch probability', `${Math.round(r.launch_probability * 100)}%`, 'from the category launch rate, this protocol\'s scale and its tokenless track record', r.launch_probability)}
      ${factor('Momentum', `${r.momentum_multiplier}x`, 'its seven-day TVL change, clamped so one hot week cannot carry a ranking', Math.min(1, Math.max(0, (r.momentum_multiplier - 0.8) / 0.6)))}
      ${factor('Survival', `${r.survival_multiplier}x`, 'years of users with no token to sell them firms the anchor up', Math.min(1, Math.max(0, (r.survival_multiplier - 0.85) / 0.15)))}
      ${factor('Implied value', money(r.implied_value_usd), 'FDV x share x probability x momentum x survival')}
    </section>
    <section class="panel"><h3>Farm plan</h3><ol class="plan">${steps}</ol></section>
  </div>`;
}

function render() {
  document.getElementById('tabBoard').classList.toggle('active', state.view === 'board');
  document.getElementById('tabLive').classList.toggle('active', state.view === 'live');
  main.innerHTML = state.view === 'live' ? liveHTML() : boardHTML();
  main.querySelectorAll('tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => {
      location.hash = `p=${tr.getAttribute('data-slug')}`;
    });
  });
}

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) {
    render();
    return;
  }
  main.innerHTML = detailHTML(r);
  document.getElementById('backBtn').addEventListener('click', () => {
    location.hash = 'board';
  });
  window.scrollTo(0, 0);
}

function route() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('p=')) return renderDetail(h.slice(2));
  if (h === 'live') {
    state.view = 'live';
    return render();
  }
  if (h.startsWith('f=')) {
    state.cat = decodeURIComponent(h.slice(2));
    catSel.value = state.cat;
  }
  state.view = 'board';
  render();
}

document.getElementById('tabBoard').addEventListener('click', () => {
  state.view = 'board';
  render();
});
document.getElementById('tabLive').addEventListener('click', () => {
  state.view = 'live';
  render();
});
document.getElementById('q').addEventListener('input', (e) => {
  state.q = e.target.value.trim().toLowerCase();
  state.view = 'board';
  render();
});
catSel.addEventListener('change', () => {
  state.cat = catSel.value;
  state.view = 'board';
  render();
});
chainSel.addEventListener('change', () => {
  state.chain = chainSel.value;
  state.view = 'board';
  render();
});
document.getElementById('watchOnly').addEventListener('change', (e) => {
  state.watchOnly = e.target.checked;
  state.view = 'board';
  render();
});
document.getElementById('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  state.view = 'board';
  render();
});
window.addEventListener('hashchange', route);
route();
