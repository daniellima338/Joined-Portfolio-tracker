// GET /api/fundamentals?ticker=AAPL
// Pulls trailing-twelve-month free cash flow per share from SEC EDGAR's free
// XBRL API — US-listed SEC filers only, no key needed. SEC requires a
// descriptive User-Agent on every request (not personal contact info, since
// this repo is public — identifies the project instead).
const SEC_USER_AGENT = 'CommingledPortfolioTracker/1.0 (+https://github.com/daniellima338/Joined-Portfolio-tracker)';

const CFO_TAGS = ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'];
const CAPEX_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireProductiveAssets'];
const SHARES_TAGS = ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingDiluted', 'CommonStockSharesOutstanding'];

// Module-scoped — survives warm serverless invocations, avoids re-fetching
// SEC's ~800KB full ticker list on every request.
let tickerMapCache = null;

async function getCik(ticker) {
  if (!tickerMapCache) {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_USER_AGENT },
    });
    if (!res.ok) throw new Error('Could not load SEC ticker list');
    const data = await res.json();
    tickerMapCache = {};
    Object.values(data).forEach((e) => {
      tickerMapCache[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
    });
  }
  return tickerMapCache[ticker.toUpperCase()] || null;
}

async function fetchConcept(cik, tag) {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const entries = data?.units?.USD || data?.units?.shares;
  return entries && entries.length > 0 ? entries : null;
}

async function fetchFirstAvailable(cik, tags) {
  for (const tag of tags) {
    const entries = await fetchConcept(cik, tag);
    if (entries) return entries;
  }
  return null;
}

const daysBetween = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// SEC reports cash-flow-statement facts cumulatively within each fiscal
// year (a "Q3" filing's value is 9-months-year-to-date, not the standalone
// quarter) rather than as clean standalone quarters. TTM = latest
// year-to-date figure, minus the same year-to-date period a year earlier,
// plus the last full fiscal year — unless the latest filing already covers
// a full year itself (right after a 10-K, before the next 10-Q).
function computeTTM(entries) {
  if (!entries || entries.length === 0) return null;
  const annual = entries.filter((e) => { const d = daysBetween(e.start, e.end); return d >= 340 && d <= 380; });
  const latest = [...entries].sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  if (!latest) return null;
  const latestDuration = daysBetween(latest.start, latest.end);

  if (latestDuration >= 340) return { value: latest.val, periodEnd: latest.end };

  const oneYearBeforeLatestEnd = new Date(latest.end);
  oneYearBeforeLatestEnd.setFullYear(oneYearBeforeLatestEnd.getFullYear() - 1);
  const priorYearSame = entries.find((e) => {
    const durationMatches = Math.abs(daysBetween(e.start, e.end) - latestDuration) <= 15;
    const yearAgoMatches = daysBetween(e.end, oneYearBeforeLatestEnd) <= 20;
    return durationMatches && yearAgoMatches && e !== latest;
  });
  const lastFullYear = annual
    .filter((e) => new Date(e.end) < new Date(latest.start))
    .sort((a, b) => new Date(b.end) - new Date(a.end))[0];

  if (!priorYearSame || !lastFullYear) return null;
  return { value: latest.val - priorYearSame.val + lastFullYear.val, periodEnd: latest.end };
}

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker query param' });

  try {
    const cik = await getCik(ticker.trim());
    if (!cik) {
      return res.status(404).json({ error: `No SEC filer found for "${ticker}" — likely a non-US listing. Enter FCF manually instead.` });
    }

    const [cfoEntries, capexEntries, sharesEntries] = await Promise.all([
      fetchFirstAvailable(cik, CFO_TAGS),
      fetchFirstAvailable(cik, CAPEX_TAGS),
      fetchFirstAvailable(cik, SHARES_TAGS),
    ]);

    if (!cfoEntries) {
      return res.status(404).json({ error: 'No operating cash flow data found in this company\'s SEC filings.' });
    }
    const cfoTTM = computeTTM(cfoEntries);
    if (!cfoTTM) {
      return res.status(422).json({ error: 'Could not compute a trailing-twelve-month figure from this company\'s filing history (e.g. too recent an IPO).' });
    }
    const capexTTM = capexEntries ? computeTTM(capexEntries) : null;

    const latestShares = sharesEntries ? [...sharesEntries].sort((a, b) => new Date(b.end) - new Date(a.end))[0] : null;
    if (!latestShares || !latestShares.val) {
      return res.status(422).json({ error: 'Found cash flow data but no diluted shares outstanding figure for this ticker.' });
    }

    const ttmCfo = cfoTTM.value;
    const ttmCapex = capexTTM?.value || 0;
    const ttmFcf = ttmCfo - ttmCapex;
    const fcfPerShare = ttmFcf / latestShares.val;

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    res.status(200).json({
      ticker: ticker.toUpperCase(),
      fcfPerShare,
      ttmCfo,
      ttmCapex,
      dilutedShares: latestShares.val,
      periodEnd: cfoTTM.periodEnd,
    });
  } catch (err) {
    console.error('fundamentals error', err);
    res.status(500).json({ error: 'Failed to fetch SEC data', details: String(err.message || err) });
  }
}
