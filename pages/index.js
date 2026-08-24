import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { Search, Plus, X, TrendingUp, TrendingDown } from 'lucide-react';

const OWNER_PALETTE = ['#E0A458', '#4FD1C5', '#A78BFA', '#7FB2E5', '#E58A8A', '#8FBF8F', '#D6A9E8', '#F2C14E'];
const QUOTE_REFRESH_MS = 60000; // gentle polling — this now runs from your browser, not a shared server

const fmtUSD = (n, decimals = 2) =>
  (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (n) => `${n >= 0 ? '+' : ''}${(n ?? 0).toFixed(2)}%`;

let idCounter = 1000;
const nextId = () => idCounter++;

const seedOwners = () => ([
  { id: 'owner-daniel', name: 'Daniel', color: OWNER_PALETTE[0] },
  { id: 'owner-alex', name: 'Alex', color: OWNER_PALETTE[1] },
]);

const seedLots = () => ([
  { ticker: 'AAPL', company: 'Apple Inc.', shares: 10, purchasePrice: 165.00, ownerIds: ['owner-daniel'], dateBought: '2024-02-14' },
  { ticker: 'MSFT', company: 'Microsoft Corp.', shares: 5, purchasePrice: 310.00, ownerIds: ['owner-daniel'], dateBought: '2023-11-03' },
  { ticker: 'NVDA', company: 'NVIDIA Corp.', shares: 8, purchasePrice: 420.00, ownerIds: ['owner-alex'], dateBought: '2024-06-21' },
  { ticker: 'VOO', company: 'Vanguard S&P 500 ETF', shares: 20, purchasePrice: 410.00, ownerIds: ['owner-daniel', 'owner-alex'], dateBought: '2023-08-17' },
]).map((h) => ({ id: nextId(), ...h }));

const ownerShareOfLot = (lot, price, ownerId) =>
  lot.ownerIds.includes(ownerId) ? (lot.shares * price) / lot.ownerIds.length : 0;

// -----------------------------------------------------------------------------
// Direct-from-browser Yahoo Finance access, with an automatic CORS-proxy
// fallback. This runs on YOUR connection, not a shared cloud server — the
// same reason it works fine for you in Excel. It's still an unofficial data
// source, so it can break or get blocked without warning; there's no backend
// involved anymore, so there's nothing server-side left to configure.
// -----------------------------------------------------------------------------
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SEARCH_BASE = 'https://query1.finance.yahoo.com/v1/finance/search';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

async function fetchJsonWithFallback(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (directErr) {
    // Direct browser call failed (likely CORS, or Yahoo rejected it) — retry via a CORS relay.
    const res2 = await fetch(CORS_PROXY + encodeURIComponent(url));
    if (!res2.ok) throw new Error(`Both direct and proxied requests failed (${directErr.message}; proxy status ${res2.status})`);
    return await res2.json();
  }
}

// One call gets both the live-ish price AND 30 days of history for a ticker.
async function fetchYahooChart(ticker) {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
  const data = await fetchJsonWithFallback(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || `No data for ${ticker}`);

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const history = timestamps
    .map((t, i) => ({ date: new Date(t * 1000).toISOString(), close: closes[i] }))
    .filter((p) => p.close != null);

  const price = meta.regularMarketPrice ?? null;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price != null && prevClose != null ? price - prevClose : 0;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;

  return {
    quote: { price, change, changePercent, currency: meta.currency || 'USD', shortName: meta.symbol || ticker },
    history,
  };
}

async function fetchYahooSearch(query) {
  const url = `${YAHOO_SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  const data = await fetchJsonWithFallback(url);
  const quotes = data?.quotes || [];
  return quotes
    .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
    .slice(0, 8)
    .map((q) => ({ ticker: q.symbol, company: q.shortname || q.longname || q.symbol }));
}

export default function Home() {
  const [owners, setOwners] = useState(seedOwners);
  const [lots, setLots] = useState(seedLots);
  const [selectedOwnerIds, setSelectedOwnerIds] = useState(() => seedOwners().map((o) => o.id));
  const [donutBy, setDonutBy] = useState('owner');
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState('');

  const [quotes, setQuotes] = useState({});
  const [historyByTicker, setHistoryByTicker] = useState({});
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesError, setQuotesError] = useState('');
  const [lastFetched, setLastFetched] = useState(null);

  const uniqueTickers = useMemo(() => [...new Set(lots.map((l) => l.ticker))], [lots]);
  const tickerKey = uniqueTickers.join(',');

  const refreshAll = async (tickers) => {
    if (tickers.length === 0) return;
    setQuotesLoading(true);
    const failures = [];
    await Promise.all(tickers.map(async (ticker) => {
      try {
        const { quote, history } = await fetchYahooChart(ticker);
        setQuotes((prev) => ({ ...prev, [ticker]: quote }));
        if (history.length > 0) setHistoryByTicker((prev) => ({ ...prev, [ticker]: history }));
      } catch (err) {
        failures.push(`${ticker}: ${err.message || err}`);
      }
    }));
    setQuotesError(failures.length === tickers.length ? failures.join(' · ') : '');
    setLastFetched(Date.now());
    setQuotesLoading(false);
  };

  useEffect(() => {
    if (uniqueTickers.length === 0) return;
    refreshAll(uniqueTickers);
    const id = setInterval(() => refreshAll(uniqueTickers), QUOTE_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  const ownersById = useMemo(() => {
    const map = {};
    owners.forEach((o) => { map[o.id] = o; });
    return map;
  }, [owners]);

  const isAllSelected = selectedOwnerIds.length === owners.length;
  const toggleOwnerFilter = (id) => {
    setSelectedOwnerIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };
  const selectAllOwners = () => setSelectedOwnerIds(owners.map((o) => o.id));

  const addOwner = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const name = newOwnerName.trim();
    if (!name) return;
    const id = `owner-${Date.now()}`;
    const color = OWNER_PALETTE[owners.length % OWNER_PALETTE.length];
    setOwners((prev) => [...prev, { id, name, color }]);
    setSelectedOwnerIds((prev) => [...prev, id]);
    setNewOwnerName('');
    setShowAddOwner(false);
  };

  const filteredLots = useMemo(
    () => lots.filter((l) => l.ownerIds.some((oid) => selectedOwnerIds.includes(oid))),
    [lots, selectedOwnerIds]
  );

  const enriched = useMemo(() => filteredLots.map((l) => {
    const q = quotes[l.ticker];
    const currentPrice = q?.price ?? l.purchasePrice;
    const value = l.shares * currentPrice;
    const cost = l.shares * l.purchasePrice;
    const gainAbs = value - cost;
    const gainPct = cost > 0 ? (gainAbs / cost) * 100 : 0;
    const dailyAbs = (q?.change ?? 0) * l.shares;
    const dailyPct = q?.changePercent ?? 0;
    return { ...l, currentPrice, value, cost, gainAbs, gainPct, dailyAbs, dailyPct };
  }), [filteredLots, quotes]);

  const totalValue = useMemo(() => enriched.reduce((s, l) => s + l.value, 0), [enriched]);
  const totalCost = useMemo(() => enriched.reduce((s, l) => s + l.cost, 0), [enriched]);
  const totalGainAbs = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGainAbs / totalCost) * 100 : 0;
  const totalDailyAbs = useMemo(() => enriched.reduce((s, l) => s + l.dailyAbs, 0), [enriched]);
  const totalDailyPct = useMemo(() => {
    const openSum = enriched.reduce((s, l) => s + l.shares * (l.currentPrice - (l.dailyAbs / (l.shares || 1))), 0);
    return openSum > 0 ? (totalDailyAbs / openSum) * 100 : 0;
  }, [enriched, totalDailyAbs]);

  const groupedHoldings = useMemo(() => {
    const byTicker = {};
    enriched.forEach((l) => {
      if (!byTicker[l.ticker]) {
        byTicker[l.ticker] = {
          ticker: l.ticker, company: l.company, currentPrice: l.currentPrice,
          dailyPct: l.dailyPct, shares: 0, cost: 0, value: 0, ownerIds: [], lotIds: [],
        };
      }
      const g = byTicker[l.ticker];
      g.shares += l.shares;
      g.cost += l.cost;
      g.value += l.value;
      g.lotIds.push(l.id);
      l.ownerIds.forEach((oid) => { if (!g.ownerIds.includes(oid)) g.ownerIds.push(oid); });
    });
    return Object.values(byTicker).map((g) => {
      const purchasePrice = g.shares > 0 ? g.cost / g.shares : 0;
      const gainAbs = g.value - g.cost;
      const gainPct = g.cost > 0 ? (gainAbs / g.cost) * 100 : 0;
      return { ...g, purchasePrice, gainAbs, gainPct, id: g.ticker };
    });
  }, [enriched]);

  const topPerformer = useMemo(() => {
    if (groupedHoldings.length === 0) return null;
    return [...groupedHoldings].sort((a, b) => b.gainPct - a.gainPct)[0];
  }, [groupedHoldings]);

  const donutData = useMemo(() => {
    if (donutBy === 'owner') {
      return owners.map((o) => ({
        name: o.name,
        value: Math.round(lots.reduce((s, l) => s + ownerShareOfLot(l, quotes[l.ticker]?.price ?? l.purchasePrice, o.id), 0) * 100) / 100,
        color: o.color,
      })).filter((d) => d.value > 0);
    }
    const palette = ['#C9A24B', '#E0A458', '#4FD1C5', '#A78BFA', '#7FB2E5', '#E58A8A', '#8FBF8F', '#D6A9E8'];
    return groupedHoldings.map((g, i) => ({ name: g.ticker, value: g.value, color: palette[i % palette.length] }));
  }, [donutBy, groupedHoldings, lots, quotes, owners]);

  const chartData = useMemo(() => {
    let refTicker = null, refLen = 0;
    uniqueTickers.forEach((t) => {
      const h = historyByTicker[t];
      if (h && h.length > refLen) { refLen = h.length; refTicker = t; }
    });
    if (!refTicker) return [];

    const closeOnOrBefore = (ticker, dateStr) => {
      const h = historyByTicker[ticker];
      if (!h || h.length === 0) return quotes[ticker]?.price ?? null;
      let result = h[0].close;
      for (const p of h) {
        if (new Date(p.date) <= new Date(dateStr)) result = p.close; else break;
      }
      return result;
    };

    return historyByTicker[refTicker].map((point) => {
      let total = 0;
      lots.forEach((l) => {
        if (!l.ownerIds.some((oid) => selectedOwnerIds.includes(oid))) return;
        const close = closeOnOrBefore(l.ticker, point.date);
        if (close != null) total += l.shares * close;
      });
      return {
        label: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: Math.round(total * 100) / 100,
      };
    });
  }, [historyByTicker, lots, selectedOwnerIds, quotes, tickerKey]);

  const filterLabel = isAllSelected
    ? 'Everyone, combined'
    : selectedOwnerIds.map((id) => ownersById[id]?.name).filter(Boolean).join(' + ');

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [form, setForm] = useState({ ticker: '', company: '', purchasePrice: '', shares: '', dateBought: new Date().toISOString().slice(0, 10), ownerIds: [] });
  const [addError, setAddError] = useState('');
  const searchDebounce = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await fetchYahooSearch(query.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(searchDebounce.current);
  }, [query]);

  const pickSuggestion = async (s) => {
    setForm((f) => ({ ...f, ticker: s.ticker, company: s.company }));
    setQuery(`${s.ticker} — ${s.company}`);
    setShowSuggest(false);
    try {
      const { quote } = await fetchYahooChart(s.ticker);
      if (quote.price) setForm((f) => ({ ...f, purchasePrice: f.purchasePrice || String(quote.price) }));
    } catch { /* ignore — user can type a price manually */ }
  };

  const toggleFormOwner = (id) => {
    setForm((f) => ({
      ...f,
      ownerIds: f.ownerIds.includes(id) ? f.ownerIds.filter((x) => x !== id) : [...f.ownerIds, id],
    }));
  };

  const handleAdd = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const ticker = form.ticker.trim().toUpperCase();
    const company = form.company.trim() || ticker;
    const shares = parseFloat(form.shares);
    const purchasePrice = parseFloat(form.purchasePrice);

    if (!ticker) return setAddError('Enter a ticker symbol.');
    if (!shares || shares <= 0) return setAddError('Enter a number of shares greater than 0.');
    if (!purchasePrice || purchasePrice <= 0) return setAddError('Enter a purchase price greater than 0.');
    if (form.ownerIds.length === 0) return setAddError('Select at least one owner.');
    setAddError('');

    setLots((prev) => [...prev, {
      id: nextId(), ticker, company, shares, purchasePrice, ownerIds: form.ownerIds, dateBought: form.dateBought,
    }]);
    setForm({ ticker: '', company: '', purchasePrice: '', shares: '', dateBought: new Date().toISOString().slice(0, 10), ownerIds: [] });
    setQuery('');
  };

  const removeLot = (id) => setLots((prev) => prev.filter((l) => l.id !== id));

  const secondsAgo = lastFetched ? Math.floor((Date.now() - lastFetched) / 1000) : null;

  return (
    <div className="ct-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .ct-root {
          --bg: #0D1117; --bg-elevated: #121821; --surface: #171E28; --surface-hover: #1D2531;
          --border: #262E3A; --text: #E7E9ED; --text-muted: #8992A3; --text-faint: #59626F;
          --gold: #C9A24B; --pos: #4ADE80; --neg: #F87171;
          font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text);
          min-height: 100vh; width: 100%; padding: 28px 20px 60px;
        }
        .ct-wrap { max-width: 1180px; margin: 0 auto; }
        .ct-header { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin-bottom: 22px; }
        .ct-title { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
        .ct-subtitle { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
        .ct-live { display: flex; align-items: center; gap: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--text-faint); }
        .ct-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pos); }
        .ct-live-dot.error { background: var(--neg); }
        .ct-error-banner { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: var(--neg); padding: 10px 14px; border-radius: 9px; font-size: 12.5px; margin-bottom: 16px; }
        .ct-tabs-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
        .ct-tabs { display: inline-flex; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 4px; gap: 2px; flex-wrap: wrap; }
        .ct-tab { padding: 8px 16px; border-radius: 7px; border: none; background: transparent; color: var(--text-muted); font-family: 'Inter'; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .ct-tab.active { background: var(--surface-hover); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); }
        .ct-tab-dot { width: 7px; height: 7px; border-radius: 50%; }
        .ct-add-owner-btn { padding: 8px 14px; border-radius: 9px; border: 1px dashed var(--border); background: transparent; color: var(--text-faint); font-size: 12.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; }
        .ct-add-owner-inline { display: flex; gap: 6px; align-items: center; }
        .ct-add-owner-inline input { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; color: var(--text); font-size: 12.5px; outline: none; width: 140px; }
        .ct-add-owner-inline button[type="submit"] { background: var(--gold); color: #16130A; border: none; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .ct-add-owner-inline button[type="submit"]:disabled { opacity: 0.4; cursor: not-allowed; }
        .ct-cancel-owner-btn { background: transparent; border: 1px solid var(--border); color: var(--text-faint); border-radius: 8px; padding: 7px 9px; cursor: pointer; display: flex; align-items: center; }
        .ct-filter-caption { color: var(--text-faint); font-size: 11.5px; margin-bottom: 18px; }
        .ct-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
        @media (max-width: 900px) { .ct-metrics { grid-template-columns: repeat(2, 1fr); } }
        .ct-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 18px 16px; }
        .ct-card-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); font-weight: 600; margin-bottom: 10px; }
        .ct-card-value { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 500; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
        .ct-card-sub { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; margin-top: 6px; display: flex; align-items: center; gap: 4px; }
        .pos { color: var(--pos); } .neg { color: var(--neg); }
        .ct-main-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; margin-bottom: 22px; }
        @media (max-width: 900px) { .ct-main-grid { grid-template-columns: 1fr; } }
        .ct-panel-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 500; margin: 0 0 2px; }
        .ct-panel-sub { color: var(--text-faint); font-size: 11.5px; margin-bottom: 14px; }
        .ct-panel-head { display: flex; justify-content: space-between; align-items: flex-start; }
        .ct-donut-toggle { display: flex; gap: 4px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 7px; padding: 3px; }
        .ct-donut-toggle button { border: none; background: transparent; color: var(--text-faint); font-size: 10.5px; font-weight: 700; text-transform: uppercase; padding: 4px 8px; border-radius: 5px; cursor: pointer; }
        .ct-donut-toggle button.active { background: var(--surface-hover); color: var(--text); }
        .ct-legend { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; max-height: 130px; overflow-y: auto; }
        .ct-legend-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
        .ct-legend-left { display: flex; align-items: center; gap: 7px; color: var(--text-muted); }
        .ct-legend-swatch { width: 8px; height: 8px; border-radius: 2px; }
        .ct-legend-val { font-family: 'IBM Plex Mono', monospace; color: var(--text); }
        .ct-section-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 500; margin: 0 0 4px; }
        .ct-section-sub { color: var(--text-faint); font-size: 12px; margin-bottom: 14px; }
        .ct-ledger { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 22px; }
        .ct-ledger-head { display: grid; grid-template-columns: 2fr 1.1fr 0.8fr 1fr 1fr 1fr 1.1fr 34px; gap: 8px; padding: 12px 18px; font-size: 10.5px; text-transform: uppercase; color: var(--text-faint); font-weight: 700; border-bottom: 1px solid var(--border); }
        .ct-ledger-row { display: grid; grid-template-columns: 2fr 1.1fr 0.8fr 1fr 1fr 1fr 1.1fr 34px; gap: 8px; padding: 13px 18px; align-items: center; border-bottom: 1px solid var(--border); font-size: 13px; }
        .ct-ledger-row:last-child { border-bottom: none; }
        .ct-ledger-row:hover { background: var(--surface-hover); }
        .ct-asset-name { display: flex; flex-direction: column; }
        .ct-asset-ticker { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 13px; }
        .ct-asset-company { color: var(--text-faint); font-size: 11px; margin-top: 1px; }
        .ct-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .ct-owner-pills { display: flex; flex-wrap: wrap; gap: 4px; }
        .ct-owner-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 100px; font-size: 10.5px; font-weight: 700; border: 1px solid; }
        .ct-badge { display: inline-flex; align-items: center; gap: 3px; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; font-weight: 600; padding: 3px 7px; border-radius: 6px; }
        .ct-badge.pos { background: rgba(74,222,128,0.12); color: var(--pos); }
        .ct-badge.neg { background: rgba(248,113,113,0.12); color: var(--neg); }
        .ct-remove-btn { background: none; border: none; color: var(--text-faint); cursor: pointer; padding: 4px; border-radius: 6px; }
        .ct-remove-btn:hover { color: var(--neg); background: rgba(248,113,113,0.1); }
        .ct-lot-count { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-faint); text-align: center; }
        .ct-empty { padding: 40px 20px; text-align: center; color: var(--text-faint); font-size: 13px; }
        .ct-form-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
        .ct-search-wrap { position: relative; margin-bottom: 14px; }
        .ct-search-input { width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px 10px 36px; color: var(--text); font-size: 13.5px; outline: none; }
        .ct-search-input:focus { border-color: var(--gold); }
        .ct-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-faint); }
        .ct-suggest { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 9px; overflow: hidden; z-index: 10; box-shadow: 0 10px 24px rgba(0,0,0,0.4); }
        .ct-suggest-item { padding: 9px 12px; cursor: pointer; display: flex; justify-content: space-between; font-size: 12.5px; }
        .ct-suggest-item:hover { background: var(--surface-hover); }
        .ct-suggest-ticker { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
        .ct-suggest-company { color: var(--text-faint); }
        .ct-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .ct-field { display: flex; flex-direction: column; gap: 5px; }
        .ct-field label { font-size: 10.5px; text-transform: uppercase; color: var(--text-faint); font-weight: 700; }
        .ct-field input { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; color: var(--text); font-size: 13px; outline: none; }
        .ct-field input:focus { border-color: var(--gold); }
        .ct-field-hint { font-size: 10.5px; color: var(--text-faint); margin-top: 2px; }
        .ct-owner-select { display: flex; gap: 6px; flex-wrap: wrap; }
        .ct-owner-opt { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); font-size: 11.5px; font-weight: 700; cursor: pointer; }
        .ct-owner-opt.active { color: var(--bg); }
        .ct-add-btn { width: 100%; background: var(--gold); color: #16130A; border: none; border-radius: 9px; padding: 11px; font-weight: 700; font-size: 13.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .ct-tooltip { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
      `}</style>

      <div className="ct-wrap">
        <div className="ct-header">
          <div>
            <h1 className="ct-title">Commingled</h1>
            <div className="ct-subtitle">Real Yahoo Finance data, fetched directly from your browser</div>
          </div>
          <div className="ct-live">
            <span className={`ct-live-dot ${quotesError ? 'error' : ''}`} />
            {quotesError ? 'Some quotes failed' : quotesLoading ? 'Fetching quotes…' : `Updated ${secondsAgo != null ? `${secondsAgo}s ago` : ''}`}
          </div>
        </div>

        {quotesError && (
          <div className="ct-error-banner">
            Couldn't reach Yahoo Finance directly or via the fallback proxy ({quotesError}). It's usually temporary — try again shortly, or check your ticker symbols.
          </div>
        )}

        <div className="ct-tabs-row">
          <div className="ct-tabs">
            <button className={`ct-tab ${isAllSelected ? 'active' : ''}`} onClick={selectAllOwners}>Everyone</button>
            {owners.map((o) => (
              <button key={o.id} className={`ct-tab ${selectedOwnerIds.includes(o.id) ? 'active' : ''}`} onClick={() => toggleOwnerFilter(o.id)}>
                <span className="ct-tab-dot" style={{ background: o.color }} />
                {o.name}
              </button>
            ))}
          </div>
          {showAddOwner ? (
            <div className="ct-add-owner-inline">
              <input
                autoFocus placeholder="Owner name" value={newOwnerName}
                onChange={(e) => setNewOwnerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addOwner(); if (e.key === 'Escape') { setShowAddOwner(false); setNewOwnerName(''); } }}
              />
              <button type="button" disabled={!newOwnerName.trim()} onClick={() => addOwner()}>Add</button>
              <button type="button" className="ct-cancel-owner-btn" onClick={() => { setShowAddOwner(false); setNewOwnerName(''); }}><X size={14} /></button>
            </div>
          ) : (
            <button className="ct-add-owner-btn" onClick={() => setShowAddOwner(true)}><Plus size={13} /> Add owner</button>
          )}
        </div>
        <div className="ct-filter-caption">Viewing: {filterLabel} — holdings are summed together, never averaged</div>

        <div className="ct-metrics">
          <div className="ct-card">
            <div className="ct-card-label">Total Portfolio Value</div>
            <div className="ct-card-value">{fmtUSD(totalValue, 0)}</div>
            <div className="ct-card-sub" style={{ color: 'var(--text-faint)' }}>{groupedHoldings.length} holding{groupedHoldings.length === 1 ? '' : 's'}</div>
          </div>
          <div className="ct-card">
            <div className="ct-card-label">Overall Profit / Loss</div>
            <div className={`ct-card-value ${totalGainAbs >= 0 ? 'pos' : 'neg'}`}>{totalGainAbs >= 0 ? '+' : ''}{fmtUSD(totalGainAbs, 0)}</div>
            <div className={`ct-card-sub ${totalGainPct >= 0 ? 'pos' : 'neg'}`}>{totalGainPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{fmtPct(totalGainPct)} all-time</div>
          </div>
          <div className="ct-card">
            <div className="ct-card-label">Today's Change</div>
            <div className={`ct-card-value ${totalDailyAbs >= 0 ? 'pos' : 'neg'}`}>{totalDailyAbs >= 0 ? '+' : ''}{fmtUSD(totalDailyAbs, 0)}</div>
            <div className={`ct-card-sub ${totalDailyPct >= 0 ? 'pos' : 'neg'}`}>{totalDailyPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{fmtPct(totalDailyPct)} vs. yesterday's close</div>
          </div>
          <div className="ct-card">
            <div className="ct-card-label">Top Performing Asset</div>
            {topPerformer ? (
              <>
                <div className="ct-card-value" style={{ fontSize: 22 }}>{topPerformer.ticker}</div>
                <div className={`ct-card-sub ${topPerformer.gainPct >= 0 ? 'pos' : 'neg'}`}>{topPerformer.gainPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{fmtPct(topPerformer.gainPct)} return</div>
              </>
            ) : <div className="ct-card-value" style={{ fontSize: 16, color: 'var(--text-faint)' }}>No holdings yet</div>}
          </div>
        </div>

        <div className="ct-main-grid">
          <div className="ct-card">
            <div className="ct-panel-title">Growth over the last 30 days</div>
            <div className="ct-panel-sub">Real historical closes · assumes today's share counts · {filterLabel}</div>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ctGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C9A24B" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#C9A24B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#262E3A" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#59626F', fontSize: 10.5, fontFamily: 'IBM Plex Mono' }} interval={4} axisLine={{ stroke: '#262E3A' }} tickLine={false} />
                <YAxis tick={{ fill: '#59626F', fontSize: 10.5, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={54} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip content={({ active, payload, label }) => active && payload && payload.length ? (
                  <div className="ct-tooltip"><div style={{ color: '#8992A3', marginBottom: 2 }}>{label}</div><div style={{ color: '#E7E9ED', fontWeight: 600 }}>{fmtUSD(payload[0].value, 0)}</div></div>
                ) : null} />
                <Area type="monotone" dataKey="value" stroke="#C9A24B" strokeWidth={2} fill="url(#ctGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="ct-card">
            <div className="ct-panel-head">
              <div><div className="ct-panel-title">Breakdown</div><div className="ct-panel-sub">By {donutBy}</div></div>
              <div className="ct-donut-toggle">
                <button className={donutBy === 'owner' ? 'active' : ''} onClick={() => setDonutBy('owner')}>Owner</button>
                <button className={donutBy === 'asset' ? 'active' : ''} onClick={() => setDonutBy('asset')}>Asset</button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={68} paddingAngle={3} stroke="none">
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => active && payload && payload.length ? (
                  <div className="ct-tooltip"><div style={{ color: '#E7E9ED' }}>{payload[0].name}: {fmtUSD(payload[0].value, 0)}</div></div>
                ) : null} />
              </PieChart>
            </ResponsiveContainer>
            <div className="ct-legend">
              {donutData.map((d, i) => (
                <div className="ct-legend-row" key={i}>
                  <div className="ct-legend-left"><span className="ct-legend-swatch" style={{ background: d.color }} />{d.name}</div>
                  <span className="ct-legend-val">{fmtUSD(d.value, 0)}</span>
                </div>
              ))}
              {donutData.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>Nothing to show yet</div>}
            </div>
          </div>
        </div>

        <div className="ct-section-title">Holdings</div>
        <div className="ct-section-sub">{filterLabel} · same ticker across owners (or multiple purchases) merges into one row with a weighted-average cost</div>
        <div className="ct-ledger">
          <div className="ct-ledger-head"><div>Asset</div><div>Owner</div><div>Shares</div><div>Avg Cost</div><div>Price</div><div>Today</div><div>Value / P&amp;L</div><div /></div>
          {groupedHoldings.length === 0 && <div className="ct-empty">No holdings in this view yet — add one below.</div>}
          {groupedHoldings.map((g) => (
            <div className="ct-ledger-row" key={g.id}>
              <div className="ct-asset-name"><span className="ct-asset-ticker">{g.ticker}</span><span className="ct-asset-company">{g.company}</span></div>
              <div className="ct-owner-pills">
                {g.ownerIds.map((oid) => ownersById[oid] ? (
                  <span key={oid} className="ct-owner-pill" style={{ color: ownersById[oid].color, borderColor: ownersById[oid].color }}>{ownersById[oid].name}</span>
                ) : null)}
              </div>
              <div className="ct-mono">{g.shares}</div>
              <div className="ct-mono">{fmtUSD(g.purchasePrice)}</div>
              <div className="ct-mono">{fmtUSD(g.currentPrice)}</div>
              <div><span className={`ct-badge ${g.dailyPct >= 0 ? 'pos' : 'neg'}`}>{g.dailyPct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{fmtPct(g.dailyPct)}</span></div>
              <div className="ct-asset-name">
                <span className="ct-mono" style={{ fontWeight: 600 }}>{fmtUSD(g.value, 0)}</span>
                <span className={`ct-mono ${g.gainAbs >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 11 }}>{g.gainAbs >= 0 ? '+' : ''}{fmtUSD(g.gainAbs, 0)} ({fmtPct(g.gainPct)})</span>
              </div>
              {g.lotIds.length === 1 ? (
                <button className="ct-remove-btn" onClick={() => removeLot(g.lotIds[0])}><X size={15} /></button>
              ) : (
                <span className="ct-lot-count">×{g.lotIds.length}</span>
              )}
            </div>
          ))}
        </div>

        <div className="ct-section-title">Add a holding</div>
        <div className="ct-section-sub">Search any ticker on any exchange worldwide — this now runs directly from your browser</div>
        <div className="ct-form-card">
          <div className="ct-search-wrap">
            <Search size={15} className="ct-search-icon" />
            <input
              className="ct-search-input" placeholder="Search ticker or company — any exchange, any country…" value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase(), company: '' })); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            />
            {showSuggest && searchResults.length > 0 && (
              <div className="ct-suggest">
                {searchResults.map((s) => (
                  <div className="ct-suggest-item" key={s.ticker} onMouseDown={() => pickSuggestion(s)}>
                    <span><span className="ct-suggest-ticker">{s.ticker}</span> <span className="ct-suggest-company">— {s.company}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="ct-form-grid">
              <div className="ct-field">
                <label>Ticker</label>
                <input value={form.ticker} onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))} placeholder="AAPL" />
                {quotes[form.ticker.trim().toUpperCase()]?.price != null && (
                  <span className="ct-field-hint">Current price: {fmtUSD(quotes[form.ticker.trim().toUpperCase()].price)}</span>
                )}
              </div>
              <div className="ct-field"><label>Company name</label><input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="Apple Inc." /></div>
              <div className="ct-field"><label>Shares</label><input type="number" step="any" min="0" value={form.shares} onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))} placeholder="10" /></div>
              <div className="ct-field"><label>Purchase price</label><input type="number" step="0.01" min="0" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} placeholder="165.00" /></div>
              <div className="ct-field"><label>Date bought</label><input type="date" value={form.dateBought} onChange={(e) => setForm((f) => ({ ...f, dateBought: e.target.value }))} /></div>
              <div className="ct-field">
                <label>Owner(s) — select one or more</label>
                <div className="ct-owner-select">
                  {owners.map((o) => (
                    <div key={o.id} className={`ct-owner-opt ${form.ownerIds.includes(o.id) ? 'active' : ''}`}
                      style={form.ownerIds.includes(o.id) ? { background: o.color, borderColor: o.color } : {}}
                      onClick={() => toggleFormOwner(o.id)}>{o.name}</div>
                  ))}
                </div>
              </div>
            </div>
            <button type="button" className="ct-add-btn" onClick={() => handleAdd()}><Plus size={16} /> Add to portfolio</button>
            {addError && <div className="ct-field-hint" style={{ textAlign: 'center', marginTop: 8, color: 'var(--neg)' }}>{addError}</div>}
          </div>
        </div>

        <div style={{ color: 'var(--text-faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30 }}>
          Data resets on page refresh — persistent storage isn't wired up yet.
        </div>
      </div>
    </div>
  );
}
