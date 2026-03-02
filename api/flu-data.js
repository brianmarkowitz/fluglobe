import { csvParse } from 'd3-dsv';
import { geoCentroid } from 'd3-geo';

const SOURCE_URLS = {
  usdaWildBirds: 'https://www.aphis.usda.gov/sites/default/files/hpai-wild-birds.csv',
  usdaMammals: 'https://www.aphis.usda.gov/sites/default/files/hpai-mammals.csv',
  usdaPoultry:
    'https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/VS_Avian_HPAIConfirmedDetections2022/HPAI2022ConfirmedDetections.csv?:showVizHome=no',
  owidHumanCases: 'https://ourworldindata.org/grapher/h5n1-flu-reported-cases.csv',
  worldGeoJson: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  usStatesGeoJson: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'
};

const COUNTRY_ALIASES = {
  'united states': 'united states of america',
  'south korea': 'korea, republic of',
  'north korea': "korea, democratic people's republic of",
  russia: 'russian federation',
  'viet nam': 'vietnam',
  'lao peoples democratic republic': 'laos',
  'syrian arab republic': 'syria',
  'iran islamic republic of': 'iran',
  'united republic of tanzania': 'tanzania',
  czechia: 'czech republic',
  timor: 'east timor',
  micronesia: 'micronesia, federated states of',
  congo: 'republic of the congo',
  'democratic republic of congo': 'democratic republic of the congo'
};

const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_MAX_POINTS = 500;
const SERVER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  Accept: 'text/csv,text/plain,application/json,*/*',
  Referer: 'https://www.aphis.usda.gov/'
};

let memoryCache = {
  createdAt: 0,
  key: '',
  payload: null
};

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const formatMonth = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const parseUsDate = (value) => {
  const input = String(value || '').replace(/\s+12:00:00\s+AM/i, '').trim();
  if (!input) return null;

  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};

const parseIsoDate = (value) => {
  const input = String(value || '').trim();
  if (!input) return null;
  const parsed = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeVirus = (value, fallback = 'H5N1') => {
  const source = String(value || '').toUpperCase();
  const explicit = source.match(/H\d+N\d+/);
  if (explicit) return explicit[0];
  if (source.includes('H5')) return 'H5';
  return fallback;
};

const classifyMammalHost = (species) => {
  const value = normalizeText(species);
  if (/(cow|cattle|bovine|dairy|goat|sheep|alpaca|llama)/.test(value)) return 'dairy';
  return 'wild';
};

const classifySeverity = (type, cases) => {
  if (type === 'poultry' || type === 'dairy') {
    if (cases >= 5000) return 'high';
    if (cases >= 250) return 'medium';
    return 'low';
  }

  if (type === 'human') {
    if (cases >= 10) return 'high';
    if (cases >= 2) return 'medium';
    return 'low';
  }

  if (cases >= 20) return 'high';
  if (cases >= 5) return 'medium';
  return 'low';
};

const roundCoord = (value) => Math.round(value * 1000) / 1000;

const selectBalancedEntries = (entries, maxPoints) => {
  if (entries.length <= maxPoints) return entries;

  const typeWeights = {
    poultry: 0.45,
    wild: 0.2,
    dairy: 0.2,
    human: 0.15
  };

  const caps = Object.fromEntries(
    Object.entries(typeWeights).map(([type, weight]) => [type, Math.max(1, Math.floor(maxPoints * weight))])
  );

  const selected = [];
  const selectedIds = new Set();
  const selectedByType = { poultry: 0, wild: 0, dairy: 0, human: 0 };

  for (const entry of entries) {
    if (selected.length >= maxPoints) break;
    const type = entry.type || 'wild';
    const cap = caps[type] ?? Math.max(1, Math.floor(maxPoints * 0.1));
    if (selectedByType[type] >= cap) continue;

    selected.push(entry);
    selectedIds.add(entry._id);
    selectedByType[type] = (selectedByType[type] || 0) + 1;
  }

  if (selected.length < maxPoints) {
    for (const entry of entries) {
      if (selected.length >= maxPoints) break;
      if (selectedIds.has(entry._id)) continue;
      selected.push(entry);
      selectedIds.add(entry._id);
    }
  }

  return selected;
};

const getQueryNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return {
    text: await response.text(),
    lastModified: response.headers.get('last-modified') || null
  };
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
};

const buildUsStateCentroids = (geoJson) => {
  const map = new Map();

  for (const feature of geoJson.features || []) {
    if (!feature?.geometry) continue;
    const name = feature?.properties?.name;
    if (!name) continue;

    const [lng, lat] = geoCentroid(feature);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    map.set(normalizeText(name), {
      name,
      lat,
      lng
    });
  }

  return map;
};

const buildWorldCentroids = (geoJson) => {
  const byCode = new Map();
  const byName = new Map();

  for (const feature of geoJson.features || []) {
    if (!feature?.geometry) continue;

    const [lng, lat] = geoCentroid(feature);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const name = feature?.properties?.name;
    const code = feature?.id;
    const centroid = {
      name,
      code,
      lat,
      lng
    };

    if (code) byCode.set(String(code).toUpperCase(), centroid);
    if (name) byName.set(normalizeText(name), centroid);
  }

  return { byCode, byName };
};

const resolveCountryCentroid = (entity, code, worldCentroids) => {
  const iso3 = String(code || '').toUpperCase().trim();
  if (iso3 && worldCentroids.byCode.has(iso3)) {
    return worldCentroids.byCode.get(iso3);
  }

  const normalized = normalizeText(entity);
  if (!normalized) return null;

  if (worldCentroids.byName.has(normalized)) {
    return worldCentroids.byName.get(normalized);
  }

  const alias = COUNTRY_ALIASES[normalized];
  if (alias) {
    const aliasKey = normalizeText(alias);
    if (worldCentroids.byName.has(aliasKey)) {
      return worldCentroids.byName.get(aliasKey);
    }
  }

  return null;
};

const pushRecord = (records, record, cutoffDate) => {
  if (!record) return;
  if (!record.dateObj || Number.isNaN(record.dateObj.getTime())) return;
  if (record.dateObj < cutoffDate) return;
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) return;
  if (!record.cases || record.cases < 0) return;
  records.push(record);
};

const buildPayload = async (lookbackDays, maxPoints) => {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - lookbackDays);

  const results = await Promise.allSettled([
    fetchJson(SOURCE_URLS.usStatesGeoJson),
    fetchJson(SOURCE_URLS.worldGeoJson),
    fetchText(SOURCE_URLS.usdaWildBirds),
    fetchText(SOURCE_URLS.usdaMammals),
    fetchText(SOURCE_URLS.usdaPoultry),
    fetchText(SOURCE_URLS.owidHumanCases)
  ]);

  const [usStatesRes, worldRes, wildRes, mammalsRes, poultryRes, humanRes] = results;

  if (usStatesRes.status !== 'fulfilled') {
    throw usStatesRes.reason;
  }

  if (worldRes.status !== 'fulfilled') {
    throw worldRes.reason;
  }

  const usStateCentroids = buildUsStateCentroids(usStatesRes.value);
  const worldCentroids = buildWorldCentroids(worldRes.value);

  const records = [];
  const warnings = [];

  if (wildRes.status === 'fulfilled') {
    const rows = csvParse(wildRes.value.text);

    for (const row of rows) {
      const stateName = String(row.State || '').trim();
      const stateCentroid = usStateCentroids.get(normalizeText(stateName));
      if (!stateCentroid) continue;

      pushRecord(
        records,
        {
          type: 'wild',
          virus: normalizeVirus(row['HPAI Strain'], 'H5N1'),
          cases: 1,
          country: `USA - ${stateCentroid.name}`,
          lat: stateCentroid.lat,
          lng: stateCentroid.lng,
          dateObj: parseUsDate(row['Date Detected']),
          source: 'USDA Wild Birds'
        },
        cutoffDate
      );
    }
  } else {
    warnings.push(
      `USDA wild birds feed unavailable (${wildRes.reason?.message || 'request failed'}).`
    );
  }

  if (mammalsRes.status === 'fulfilled') {
    const rows = csvParse(mammalsRes.value.text);

    for (const row of rows) {
      const stateName = String(row.State || '').trim();
      const stateCentroid = usStateCentroids.get(normalizeText(stateName));
      if (!stateCentroid) continue;

      const type = classifyMammalHost(row.Species);
      pushRecord(
        records,
        {
          type,
          virus: normalizeVirus(row['HPAI Strain'], 'H5N1'),
          cases: 1,
          country: `USA - ${stateCentroid.name}`,
          lat: stateCentroid.lat,
          lng: stateCentroid.lng,
          dateObj: parseUsDate(row['Date Detected']),
          source: 'USDA Mammals'
        },
        cutoffDate
      );
    }
  } else {
    warnings.push(
      `USDA mammals feed unavailable (${mammalsRes.reason?.message || 'request failed'}).`
    );
  }

  if (poultryRes.status === 'fulfilled') {
    const rows = csvParse(poultryRes.value.text);

    for (const row of rows) {
      const stateName = String(row.State || '').trim();
      const stateCentroid = usStateCentroids.get(normalizeText(stateName));
      if (!stateCentroid) continue;

      const birdsAffected = parseNumber(row['Birds Affected']);
      if (birdsAffected <= 0) continue;

      pushRecord(
        records,
        {
          type: 'poultry',
          virus: 'H5N1',
          cases: birdsAffected,
          country: `USA - ${stateCentroid.name}`,
          lat: stateCentroid.lat,
          lng: stateCentroid.lng,
          dateObj: parseUsDate(row.Confirmed),
          source: 'USDA Poultry'
        },
        cutoffDate
      );
    }
  } else {
    warnings.push(
      `USDA poultry feed unavailable (${poultryRes.reason?.message || 'request failed'}).`
    );
  }

  if (humanRes.status === 'fulfilled') {
    const rows = csvParse(humanRes.value.text);
    const valueColumn = rows.columns.find((col) => col.includes('Human cases'));

    for (const row of rows) {
      const code = String(row.Code || '').trim();
      if (!code) continue;

      const cases = parseNumber(row[valueColumn]);
      if (cases <= 0) continue;

      const dateObj = parseIsoDate(row.Day);
      if (!dateObj || dateObj < cutoffDate) continue;

      const centroid = resolveCountryCentroid(row.Entity, code, worldCentroids);
      if (!centroid) continue;

      pushRecord(
        records,
        {
          type: 'human',
          virus: 'H5N1',
          cases,
          country: centroid.name || row.Entity,
          lat: centroid.lat,
          lng: centroid.lng,
          dateObj,
          source: 'OWID (WHO data)'
        },
        cutoffDate
      );
    }
  } else {
    warnings.push(
      `OWID human cases feed unavailable (${humanRes.reason?.message || 'request failed'}).`
    );
  }

  const grouped = new Map();

  for (const row of records) {
    const monthBucket = formatMonth(row.dateObj);
    const key = [
      row.type,
      row.virus,
      row.country,
      monthBucket,
      roundCoord(row.lat),
      roundCoord(row.lng)
    ].join('|');

    if (!grouped.has(key)) {
      grouped.set(key, {
        type: row.type,
        virus: row.virus,
        country: row.country,
        dateObj: row.dateObj,
        monthBucket,
        lat: row.lat,
        lng: row.lng,
        cases: 0,
        detections: 0,
        source: row.source
      });
    }

    const entry = grouped.get(key);
    entry.cases += row.cases;
    entry.detections += 1;
    if (row.dateObj > entry.dateObj) entry.dateObj = row.dateObj;
  }

  const sortedGroupedEntries = Array.from(grouped.values())
    .sort((a, b) => {
      const byDate = b.dateObj - a.dateObj;
      if (byDate !== 0) return byDate;
      return b.cases - a.cases;
    })
    .map((entry, index) => ({ ...entry, _id: index + 1 }));

  const limitedEntries = selectBalancedEntries(sortedGroupedEntries, maxPoints);

  const outbreaks = limitedEntries.map((entry, index) => ({
      id: index + 1,
      lat: roundCoord(entry.lat),
      lng: roundCoord(entry.lng),
      country: entry.country,
      cases: Math.round(entry.cases),
      date: entry.monthBucket,
      month: Number(entry.monthBucket.split('-')[1]),
      timestamp: entry.dateObj.toISOString(),
      severity: classifySeverity(entry.type, entry.cases),
      type: entry.type,
      virus: entry.virus,
      source: entry.source,
      detections: entry.detections
    }));

  const totalCases = sortedGroupedEntries.reduce((sum, row) => sum + Math.round(row.cases), 0);
  const normalizedCountries = new Set(
    sortedGroupedEntries.map((row) => (row.country.startsWith('USA - ') ? 'USA' : row.country))
  );

  const usLivestockCases = sortedGroupedEntries
    .filter((row) => row.country.startsWith('USA - ') && (row.type === 'poultry' || row.type === 'dairy'))
    .reduce((sum, row) => sum + Math.round(row.cases), 0);

  const humanCases = sortedGroupedEntries
    .filter((row) => row.type === 'human')
    .reduce((sum, row) => sum + Math.round(row.cases), 0);

  const latestEventDate =
    sortedGroupedEntries.length > 0 ? sortedGroupedEntries[0].dateObj.toISOString() : null;

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    maxPoints,
    outbreaks,
    stats: {
      totalCases,
      countriesCount: normalizedCountries.size,
      usLivestockCases,
      humanCases,
      latestEventDate
    },
    sources: [
      {
        label: 'USDA Wild Birds CSV',
        url: SOURCE_URLS.usdaWildBirds,
        lastModified: wildRes.status === 'fulfilled' ? wildRes.value.lastModified : null
      },
      {
        label: 'USDA Mammals CSV',
        url: SOURCE_URLS.usdaMammals,
        lastModified: mammalsRes.status === 'fulfilled' ? mammalsRes.value.lastModified : null
      },
      {
        label: 'USDA Poultry Tableau CSV',
        url: SOURCE_URLS.usdaPoultry,
        lastModified: poultryRes.status === 'fulfilled' ? poultryRes.value.lastModified : null
      },
      {
        label: 'OWID H5N1 Human Cases',
        url: SOURCE_URLS.owidHumanCases,
        lastModified: humanRes.status === 'fulfilled' ? humanRes.value.lastModified : null
      }
    ],
    warnings
  };
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const lookbackDays = getQueryNumber(req.query.days, DEFAULT_LOOKBACK_DAYS, 30, 1460);
  const maxPoints = getQueryNumber(req.query.maxPoints, DEFAULT_MAX_POINTS, 50, 2000);
  const force = String(req.query.force || '').toLowerCase() === '1' || String(req.query.force || '').toLowerCase() === 'true';
  const cacheKey = `${lookbackDays}:${maxPoints}`;

  const now = Date.now();
  const cacheIsFresh =
    memoryCache.payload &&
    memoryCache.key === cacheKey &&
    now - memoryCache.createdAt < SERVER_CACHE_TTL_MS;

  if (!force && cacheIsFresh) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=43200, stale-while-revalidate=43200');
    res.status(200).json(memoryCache.payload);
    return;
  }

  try {
    const payload = await buildPayload(lookbackDays, maxPoints);

    memoryCache = {
      key: cacheKey,
      createdAt: now,
      payload
    };

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=43200, stale-while-revalidate=43200');
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to build live flu dataset',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
