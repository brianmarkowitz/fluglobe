import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as d3 from 'd3';

const FluGlobeVisualization = () => {
  const BASE_GLOBE_SCALE = 295;
  const MIN_ZOOM_LEVEL = 1;
  const MAX_ZOOM_LEVEL = 3.25;
  const LIVE_DATA_CACHE_KEY = 'fluglobe-live-data-v1';
  const LIVE_DATA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  const [rotation, setRotation] = useState([0, -20, 0]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [hoveredOutbreak, setHoveredOutbreak] = useState(null);
  const [selectedFlyway, setSelectedFlyway] = useState(null);
  const [showMigration, setShowMigration] = useState(true);
  const [showOutbreaks, setShowOutbreaks] = useState(true);
  const [animationPhase, setAnimationPhase] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveOutbreakData, setLiveOutbreakData] = useState([]);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null);
  const [dataWarnings, setDataWarnings] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  const [dataError, setDataError] = useState('');
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [isUsingFallbackData, setIsUsingFallbackData] = useState(true);
  
  // New filter states
  const [virusFilter, setVirusFilter] = useState('all');
  const [hostFilter, setHostFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [outbreakView, setOutbreakView] = useState('location');
  const [showLabels, setShowLabels] = useState(false);
  const pinchZoomRef = useRef(null);

  const width = 620;
  const height = 620;
  const sensitivity = 0.4;

  const clampZoom = useCallback(
    (nextZoom) => Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, nextZoom)),
    []
  );

  // Load world countries GeoJSON
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(res => res.json())
      .then(topology => {
        const geojson = topojsonToGeojson(topology, topology.objects.countries);
        setCountries(geojson.features);
        setLoading(false);
      })
      .catch(() => {
        fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
          .then(res => res.json())
          .then(data => {
            setCountries(data.features);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      });
  }, []);

  const parseOutbreakDate = (outbreak) => {
    if (outbreak?.timestamp) {
      const parsed = new Date(outbreak.timestamp);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const label = String(outbreak?.date || '').trim();
    if (!label) return null;

    if (/^\d{4}-\d{2}$/.test(label)) {
      const parsed = new Date(`${label}-01T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
      const parsed = new Date(`${label}T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(label);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const loadLiveData = useCallback(async (forceRefresh = false) => {
    setIsRefreshingData(true);
    setDataError('');

    let cached = null;
    try {
      const raw = localStorage.getItem(LIVE_DATA_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {
      cached = null;
    }

    if (!forceRefresh && cached?.savedAt && Array.isArray(cached?.outbreaks)) {
      const age = Date.now() - cached.savedAt;
      if (age < LIVE_DATA_CACHE_TTL_MS) {
        setLiveOutbreakData(cached.outbreaks);
        setLiveStats(cached.stats || null);
        setDataUpdatedAt(cached.generatedAt || null);
        setDataWarnings(cached.warnings || []);
        setIsUsingFallbackData(false);
        setIsRefreshingData(false);
        return;
      }
    }

    try {
      const query = forceRefresh ? `?force=1&t=${Date.now()}` : '';
      const response = await fetch(`/api/flu-data${query}`);
      if (!response.ok) {
        throw new Error(`Live data request failed (${response.status})`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload?.outbreaks) || payload.outbreaks.length === 0) {
        throw new Error('Live data endpoint returned no rows');
      }

      setLiveOutbreakData(payload.outbreaks);
      setLiveStats(payload.stats || null);
      setDataUpdatedAt(payload.generatedAt || null);
      setDataWarnings(payload.warnings || []);
      setIsUsingFallbackData(false);

      try {
        localStorage.setItem(
          LIVE_DATA_CACHE_KEY,
          JSON.stringify({
            savedAt: Date.now(),
            outbreaks: payload.outbreaks,
            stats: payload.stats || null,
            warnings: payload.warnings || [],
            generatedAt: payload.generatedAt || null
          })
        );
      } catch {
        // Ignore local storage write errors.
      }
    } catch (error) {
      if (cached?.outbreaks?.length) {
        setLiveOutbreakData(cached.outbreaks);
        setLiveStats(cached.stats || null);
        setDataUpdatedAt(cached.generatedAt || null);
        setDataWarnings([
          ...new Set([...(cached.warnings || []), 'Using last cached live data due to refresh failure.'])
        ]);
        setIsUsingFallbackData(false);
      } else {
        setLiveOutbreakData([]);
        setLiveStats(null);
        setDataUpdatedAt(null);
        setDataWarnings([]);
        setIsUsingFallbackData(true);
      }

      setDataError(error instanceof Error ? error.message : 'Live data refresh failed');
    } finally {
      setIsRefreshingData(false);
    }
  }, []);

  useEffect(() => {
    loadLiveData(false);
  }, [loadLiveData]);

  // TopoJSON to GeoJSON converter
  const topojsonToGeojson = (topology, object) => {
    const { arcs, transform } = topology;
    const { scale, translate } = transform || { scale: [1, 1], translate: [0, 0] };

    const decodeArc = (arcIndex) => {
      const reverse = arcIndex < 0;
      const index = reverse ? ~arcIndex : arcIndex;
      const arc = arcs[index];
      const coordinates = [];
      let x = 0, y = 0;

      for (const [dx, dy] of arc) {
        x += dx;
        y += dy;
        coordinates.push([
          x * scale[0] + translate[0],
          y * scale[1] + translate[1]
        ]);
      }

      return reverse ? coordinates.reverse() : coordinates;
    };

    const decodeRing = (ring) => {
      const coordinates = [];
      for (const arcIndex of ring) {
        const arcCoords = decodeArc(arcIndex);
        if (coordinates.length > 0) {
          coordinates.push(...arcCoords.slice(1));
        } else {
          coordinates.push(...arcCoords);
        }
      }
      return coordinates;
    };

    const features = object.geometries.map((geom) => {
      let coordinates;
      if (geom.type === 'Polygon') {
        coordinates = geom.arcs.map(decodeRing);
      } else if (geom.type === 'MultiPolygon') {
        coordinates = geom.arcs.map(polygon => polygon.map(decodeRing));
      } else {
        coordinates = [];
      }
      return {
        type: 'Feature',
        properties: geom.properties || { id: geom.id },
        geometry: { type: geom.type, coordinates }
      };
    });

    return { type: 'FeatureCollection', features };
  };

  // Enhanced outbreak data with virus strains
  const outbreakData = [
    { id: 1, lat: 52, lng: -1, country: 'United Kingdom', cases: 156, date: '2024-12', month: 12, severity: 'high', type: 'poultry', virus: 'H5N1' },
    { id: 2, lat: 52, lng: 5, country: 'Netherlands', cases: 89, date: '2024-12', month: 12, severity: 'high', type: 'wild', virus: 'H5N1' },
    { id: 3, lat: 51, lng: 10, country: 'Germany', cases: 234, date: '2024-12', month: 12, severity: 'high', type: 'poultry', virus: 'H5N1' },
    { id: 4, lat: 47, lng: 2, country: 'France', cases: 178, date: '2024-12', month: 12, severity: 'high', type: 'poultry', virus: 'H5N1' },
    { id: 5, lat: 52, lng: 20, country: 'Poland', cases: 145, date: '2024-11', month: 11, severity: 'medium', type: 'wild', virus: 'H5N5' },
    { id: 6, lat: 47, lng: 19, country: 'Hungary', cases: 67, date: '2024-10', month: 10, severity: 'medium', type: 'poultry', virus: 'H5N1' },
    { id: 7, lat: 42, lng: 12, country: 'Italy', cases: 98, date: '2024-11', month: 11, severity: 'medium', type: 'wild', virus: 'H5N1' },
    { id: 8, lat: 39, lng: -98, country: 'USA Central', cases: 892, date: '2024-12', month: 12, severity: 'high', type: 'dairy', virus: 'H5N1' },
    { id: 9, lat: 45, lng: -93, country: 'USA Midwest', cases: 456, date: '2024-11', month: 11, severity: 'high', type: 'poultry', virus: 'H5N1' },
    { id: 10, lat: 36, lng: -119, country: 'USA California', cases: 234, date: '2024-12', month: 12, severity: 'high', type: 'dairy', virus: 'H5N1' },
    { id: 11, lat: 12, lng: 105, country: 'Cambodia', cases: 12, date: '2025-01', month: 1, severity: 'low', type: 'human', virus: 'H5N1' },
    { id: 12, lat: 35, lng: 105, country: 'China', cases: 45, date: '2024-12', month: 12, severity: 'medium', type: 'poultry', virus: 'H9N2' },
    { id: 13, lat: 36, lng: 128, country: 'South Korea', cases: 89, date: '2024-11', month: 11, severity: 'medium', type: 'poultry', virus: 'H5N1' },
    { id: 14, lat: 36, lng: 138, country: 'Japan', cases: 123, date: '2024-12', month: 12, severity: 'medium', type: 'poultry', virus: 'H5N1' },
    { id: 15, lat: -33, lng: -71, country: 'Chile', cases: 234, date: '2024-10', month: 10, severity: 'high', type: 'wild', virus: 'H5N1' },
    { id: 16, lat: -10, lng: -76, country: 'Peru', cases: 567, date: '2024-09', month: 9, severity: 'high', type: 'wild', virus: 'H5N1' },
    { id: 17, lat: -64, lng: -60, country: 'Antarctica', cases: 89, date: '2024-11', month: 11, severity: 'medium', type: 'wild', virus: 'H5N1' },
    { id: 18, lat: 65, lng: -18, country: 'Iceland', cases: 34, date: '2024-12', month: 12, severity: 'low', type: 'wild', virus: 'H5N1' },
    { id: 19, lat: 62, lng: 10, country: 'Norway', cases: 56, date: '2024-12', month: 12, severity: 'medium', type: 'wild', virus: 'H5N5' },
    { id: 20, lat: -29, lng: 24, country: 'South Africa', cases: 78, date: '2024-08', month: 8, severity: 'medium', type: 'wild', virus: 'H5N1' },
    { id: 21, lat: 56, lng: 38, country: 'Russia', cases: 112, date: '2024-10', month: 10, severity: 'medium', type: 'wild', virus: 'H5N1' },
    { id: 22, lat: -2, lng: 118, country: 'Indonesia', cases: 34, date: '2024-11', month: 11, severity: 'low', type: 'poultry', virus: 'H5N1' },
    { id: 23, lat: 15, lng: 101, country: 'Thailand', cases: 23, date: '2024-10', month: 10, severity: 'low', type: 'poultry', virus: 'H5N1' },
    { id: 24, lat: 31, lng: 35, country: 'Israel', cases: 67, date: '2024-12', month: 12, severity: 'medium', type: 'poultry', virus: 'H5N1' },
    { id: 25, lat: 30, lng: 120, country: 'China East', cases: 28, date: '2024-11', month: 11, severity: 'low', type: 'human', virus: 'H9N2' },
    { id: 26, lat: 23, lng: 113, country: 'China South', cases: 15, date: '2024-10', month: 10, severity: 'low', type: 'poultry', virus: 'H7N9' },
    { id: 27, lat: 55, lng: -3, country: 'Scotland', cases: 42, date: '2024-11', month: 11, severity: 'medium', type: 'wild', virus: 'H5N1' },
    { id: 28, lat: 60, lng: 25, country: 'Finland', cases: 31, date: '2024-12', month: 12, severity: 'low', type: 'wild', virus: 'H5N5' },
  ];

  const displayedOutbreakData = liveOutbreakData.length > 0 ? liveOutbreakData : outbreakData;

  const virusOptions = useMemo(() => {
    const options = new Set(
      displayedOutbreakData
        .map((item) => item.virus)
        .filter(Boolean)
    );
    return ['all', ...Array.from(options).sort((a, b) => a.localeCompare(b))];
  }, [displayedOutbreakData]);

  useEffect(() => {
    if (virusFilter !== 'all' && !virusOptions.includes(virusFilter)) {
      setVirusFilter('all');
    }
  }, [virusFilter, virusOptions]);

  // Filter outbreaks based on user selections
  const filteredOutbreaks = displayedOutbreakData.filter(o => {
    if (virusFilter !== 'all' && o.virus !== virusFilter) return false;
    if (hostFilter !== 'all' && o.type !== hostFilter) return false;
    if (severityFilter !== 'all' && o.severity !== severityFilter) return false;

    const eventDate = parseOutbreakDate(o);
    if (timeRange === 'recent') {
      if (!eventDate) return false;
      if ((Date.now() - eventDate.getTime()) / (1000 * 60 * 60 * 24) > 45) return false;
    }
    if (timeRange === 'q4') {
      if (!eventDate) return false;
      if ((Date.now() - eventDate.getTime()) / (1000 * 60 * 60 * 24) > 120) return false;
    }
    return true;
  });

  const aggregatedOutbreaks = useMemo(() => {
    const groups = new Map();
    const severityOrder = { low: 1, medium: 2, high: 3 };

    for (const item of filteredOutbreaks) {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const key = `${lat.toFixed(3)}|${lng.toFixed(3)}`;

      if (!groups.has(key)) {
        groups.set(key, {
          lat,
          lng,
          country: item.country,
          cases: 0,
          detections: 0,
          eventCount: 0,
          typeCounts: {},
          virusCounts: {},
          latestDate: null,
          latestDateLabel: item.date,
          topSeverity: item.severity || 'low',
          sources: new Set()
        });
      }

      const entry = groups.get(key);
      const cases = Number(item.cases) || 0;
      const detections = Number(item.detections) || 1;
      const eventDate = parseOutbreakDate(item);

      entry.cases += cases;
      entry.detections += detections;
      entry.eventCount += 1;
      entry.typeCounts[item.type] = (entry.typeCounts[item.type] || 0) + 1;
      entry.virusCounts[item.virus] = (entry.virusCounts[item.virus] || 0) + 1;
      if (item.source) entry.sources.add(item.source);

      if (!entry.latestDate || (eventDate && eventDate > entry.latestDate)) {
        entry.latestDate = eventDate;
        entry.latestDateLabel = item.date;
      }

      const currentRank = severityOrder[entry.topSeverity] || 1;
      const nextRank = severityOrder[item.severity] || 1;
      if (nextRank > currentRank) {
        entry.topSeverity = item.severity;
      }
    }

    const dominantKey = (counts, fallback) => {
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] || fallback;
    };

    return Array.from(groups.values())
      .map((entry, idx) => ({
        id: `location-${idx + 1}`,
        lat: entry.lat,
        lng: entry.lng,
        country: entry.country,
        cases: Math.round(entry.cases),
        date: entry.latestDateLabel,
        severity: entry.topSeverity,
        type: dominantKey(entry.typeCounts, 'wild'),
        virus: dominantKey(entry.virusCounts, 'H5N1'),
        source: entry.sources.size > 1
          ? `${entry.sources.size} sources`
          : (Array.from(entry.sources)[0] || 'Source unavailable'),
        detections: entry.detections,
        eventCount: entry.eventCount,
        isAggregated: true
      }))
      .sort((a, b) => b.cases - a.cases);
  }, [filteredOutbreaks]);

  const outbreakMarkers = outbreakView === 'location' ? aggregatedOutbreaks : filteredOutbreaks;

  useEffect(() => {
    setHoveredOutbreak(null);
  }, [outbreakView, filteredOutbreaks.length]);

  const stats = useMemo(() => {
    if (liveStats) return liveStats;

    const totalCases = displayedOutbreakData.reduce((sum, row) => sum + (Number(row.cases) || 0), 0);
    const countriesCount = new Set(
      displayedOutbreakData.map((row) => (row.country?.startsWith('USA - ') ? 'USA' : row.country))
    ).size;

    const usLivestockCases = displayedOutbreakData
      .filter((row) => row.country?.startsWith('USA - ') && (row.type === 'poultry' || row.type === 'dairy'))
      .reduce((sum, row) => sum + (Number(row.cases) || 0), 0);

    const humanCases = displayedOutbreakData
      .filter((row) => row.type === 'human')
      .reduce((sum, row) => sum + (Number(row.cases) || 0), 0);

    return { totalCases, countriesCount, usLivestockCases, humanCases };
  }, [displayedOutbreakData, liveStats]);

  // Flyways
  const flyways = [
    { name: 'Atlantic Americas', color: '#00d4ff', description: 'Arctic to South America', species: 'Waterfowl, Shorebirds', birds: '350+ species', points: [[72, -65], [60, -68], [48, -72], [38, -76], [28, -80], [18, -78], [8, -72], [-5, -62], [-20, -55], [-38, -62]] },
    { name: 'Mississippi', color: '#00ff88', description: 'Canada to Gulf of Mexico', species: 'Mallards, Snow Geese', birds: '40% of waterfowl', points: [[62, -98], [54, -96], [46, -94], [40, -92], [34, -91], [29, -92]] },
    { name: 'Pacific Americas', color: '#ff6b6b', description: 'Alaska to Patagonia', species: 'Shorebirds', birds: '350+ species', points: [[64, -155], [58, -140], [48, -126], [38, -122], [25, -112], [10, -88], [-8, -78], [-30, -72], [-48, -74]] },
    { name: 'East Atlantic', color: '#a855f7', description: 'Greenland to West Africa', species: 'Barnacle Geese', birds: 'Millions', points: [[74, -42], [68, -25], [58, -10], [48, -6], [38, -9], [28, -14], [18, -16], [8, -8], [0, 2]] },
    { name: 'Black Sea-Mediterranean', color: '#ec4899', description: 'E. Europe to E. Africa', species: 'White Storks, Raptors', birds: '2B+ annually', points: [[58, 34], [50, 32], [44, 30], [38, 32], [32, 34], [24, 36], [14, 38], [4, 36], [-6, 32]] },
    { name: 'Central Asian', color: '#f59e0b', description: 'Siberia to India', species: 'Waterfowl, Cranes', birds: 'Key HPAI route', points: [[68, 78], [60, 74], [52, 70], [44, 68], [36, 72], [28, 76], [22, 80]] },
    { name: 'East Asian-Australasian', color: '#14b8a6', description: 'Siberia to Australia', species: 'Bar-tailed Godwits', birds: '50M+ birds', points: [[68, 145], [60, 138], [50, 128], [40, 122], [30, 120], [20, 118], [10, 118], [0, 124], [-12, 132], [-24, 142], [-34, 148]] },
    { name: 'West Pacific', color: '#06b6d4', description: 'Japan to SE Asia', species: 'Shorebirds, Herons', birds: 'Critical route', points: [[52, 142], [44, 138], [36, 132], [26, 124], [16, 118], [6, 112], [-4, 110]] },
  ];

  // Animation
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 1000);
      if (autoRotate && !isDragging) {
        setRotation(prev => [(prev[0] + 0.08) % 360, prev[1], prev[2]]);
      }
    }, 25);
    return () => clearInterval(interval);
  }, [autoRotate, isDragging]);

  useEffect(() => {
    if (zoomLevel > 1.01 && autoRotate) {
      setAutoRotate(false);
    }
  }, [zoomLevel, autoRotate]);

  // Projection
  const projection = d3.geoOrthographic()
    .scale(BASE_GLOBE_SCALE * zoomLevel)
    .rotate(rotation)
    .translate([width / 2, height / 2]);

  const path = d3.geoPath().projection(projection);
  const graticule = d3.geoGraticule().step([20, 20]);

  const isVisible = (coords) => {
    const center = projection.invert([width / 2, height / 2]);
    if (!center) return false;
    return d3.geoDistance(coords, center) < Math.PI / 2;
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#ff2d55';
      case 'medium': return '#ff9500';
      case 'low': return '#ffcc00';
      default: return '#ff9500';
    }
  };

  const getVirusColor = (virus) => {
    switch (virus) {
      case 'H5N1': return '#ff2d55';
      case 'H5N5': return '#a855f7';
      case 'H9N2': return '#f59e0b';
      case 'H7N9': return '#06b6d4';
      default: return '#ff9500';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'poultry': return '🐔';
      case 'wild': return '🦆';
      case 'dairy': return '🐄';
      case 'human': return '👤';
      default: return '🦠';
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'poultry': return '#ff6b6b';
      case 'wild': return '#14b8a6';
      case 'dairy': return '#06b6d4';
      case 'human': return '#a855f7';
      default: return '#ff9500';
    }
  };

  const getOutbreakColor = (outbreak) => {
    if (virusFilter !== 'all') return getVirusColor(outbreak.virus);
    if (outbreakView === 'location' && hostFilter === 'all' && severityFilter === 'all') {
      return getTypeColor(outbreak.type);
    }
    return getSeverityColor(outbreak.severity);
  };

  // Mouse handlers
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setAutoRotate(false);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top, rotation: [...rotation] });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - rect.left - dragStart.x) * sensitivity;
    const dy = (e.clientY - rect.top - dragStart.y) * sensitivity;
    setRotation([dragStart.rotation[0] - dx, Math.max(-60, Math.min(60, dragStart.rotation[1] + dy)), 0]);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  const updateZoomLevel = (nextZoom) => {
    const clamped = clampZoom(nextZoom);
    setZoomLevel(clamped);
    if (clamped > 1.01) {
      setAutoRotate(false);
    }
  };

  const getRelativePoint = (clientX, clientY, element) => {
    const rect = element.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const getTouchDistance = (touchA, touchB) => {
    const dx = touchA.clientX - touchB.clientX;
    const dy = touchA.clientY - touchB.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0016);
    updateZoomLevel(zoomLevel * factor);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      pinchZoomRef.current = {
        startDistance: distance,
        startZoom: zoomLevel
      };
      setIsDragging(false);
      setDragStart(null);
      setAutoRotate(false);
      return;
    }

    if (e.touches.length === 1) {
      const point = getRelativePoint(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget);
      setIsDragging(true);
      setAutoRotate(false);
      setDragStart({ x: point.x, y: point.y, rotation: [...rotation] });
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && pinchZoomRef.current) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      if (pinchZoomRef.current.startDistance > 0) {
        const ratio = distance / pinchZoomRef.current.startDistance;
        updateZoomLevel(pinchZoomRef.current.startZoom * ratio);
      }
      return;
    }

    if (e.touches.length === 1 && isDragging && dragStart) {
      e.preventDefault();
      const point = getRelativePoint(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget);
      const dx = (point.x - dragStart.x) * sensitivity;
      const dy = (point.y - dragStart.y) * sensitivity;
      setRotation([dragStart.rotation[0] - dx, Math.max(-60, Math.min(60, dragStart.rotation[1] + dy)), 0]);
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length < 2) {
      pinchZoomRef.current = null;
    }

    if (e.touches.length === 0) {
      setIsDragging(false);
      setDragStart(null);
    }
  };

  // Create flyway path
  const createFlywayPath = (points) => {
    const projected = [];
    for (let i = 0; i < points.length; i++) {
      const coords = [points[i][1], points[i][0]];
      if (isVisible(coords)) {
        const p = projection(coords);
        if (p) projected.push(p);
      }
    }
    if (projected.length < 2) return null;
    return d3.line().curve(d3.curveCatmullRom.alpha(0.5))(projected);
  };

  // Get animated bird position
  const getAnimatedBird = (points, progress) => {
    const totalLen = points.length - 1;
    const pos = progress * totalLen;
    const idx = Math.floor(pos);
    const t = pos - idx;
    
    if (idx >= totalLen) {
      const coords = [points[totalLen][1], points[totalLen][0]];
      if (!isVisible(coords)) return null;
      const pt = projection(coords);
      return pt ? { x: pt[0], y: pt[1], angle: 180 } : null;
    }
    
    const lat = points[idx][0] + (points[idx + 1][0] - points[idx][0]) * t;
    const lng = points[idx][1] + (points[idx + 1][1] - points[idx][1]) * t;
    const coords = [lng, lat];
    
    if (!isVisible(coords)) return null;
    const pt = projection(coords);
    if (!pt) return null;
    
    const prevIdx = Math.max(0, idx);
    const nextIdx = Math.min(totalLen, idx + 1);
    const prevCoords = [points[prevIdx][1], points[prevIdx][0]];
    const nextCoords = [points[nextIdx][1], points[nextIdx][0]];
    const prevPt = projection(prevCoords);
    const nextPt = projection(nextCoords);
    
    let angle = 180;
    if (prevPt && nextPt) {
      angle = Math.atan2(nextPt[1] - prevPt[1], nextPt[0] - prevPt[0]) * (180 / Math.PI) + 90;
    }
    
    return { x: pt[0], y: pt[1], angle };
  };

  // Migratory bird silhouette
  const MigratoryBird = ({ x, y, angle, color, size = 1 }) => (
    <g transform={`translate(${x}, ${y}) rotate(${angle}) scale(${size})`}>
      <path
        d={`M 0,0 C -4,-3 -10,-4 -18,-2 C -14,-1 -10,0 -6,1 C -3,2 -1,3 0,4 C 1,3 3,2 6,1 C 10,0 14,-1 18,-2 C 10,-4 4,-3 0,0 Z`}
        fill={color}
      />
      <ellipse cx="0" cy="1" rx="2" ry="4" fill={color} />
      <path d={`M 0,-3 C 0,-5 0.5,-7 0,-9 C 0.5,-9.5 1,-9 0.5,-8.5 C 0,-8 0,-6 0,-3`} fill={color} />
      <path d={`M -1.5,5 L 0,9 L 1.5,5 Z`} fill={color} />
    </g>
  );

  // Control button style
  const btnStyle = (active) => ({
    padding: '5px 10px',
    background: active ? 'rgba(0,212,255,0.2)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? '#00d4ff' : '#333'}`,
    borderRadius: '4px',
    color: active ? '#00d4ff' : '#888',
    cursor: 'pointer',
    fontSize: '0.6rem',
    fontWeight: '500',
    transition: 'all 0.15s'
  });

  const getOutbreakRadius = (outbreak) => {
    const cases = Math.max(1, Number(outbreak?.cases) || 1);
    const detections = Math.max(1, Number(outbreak?.detections) || 1);
    const logCases = Math.log10(cases + 1);

    if (outbreak?.type === 'poultry' || outbreak?.type === 'dairy') {
      // Livestock rows can represent very large counts, so use a capped log scale.
      return Math.min(20, 4 + logCases * 1.8 + Math.sqrt(detections) * 0.7);
    }

    if (outbreak?.type === 'human') {
      return Math.min(14, 4 + Math.sqrt(cases) * 0.8);
    }

    return Math.min(12, 3 + Math.sqrt(detections) * 1.8);
  };

  const liveWarningSummary =
    dataWarnings.length > 0
      ? 'Some source feeds are temporarily unavailable. Showing available live data.'
      : '';

  const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const standardNumber = new Intl.NumberFormat('en-US');
  const isZoomedIn = zoomLevel > 1.01;
  const formattedUpdatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #080c15 0%, #0d1320 50%, #060810 100%)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      color: '#e0e0e0',
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <h1 style={{
          fontSize: 'clamp(1.2rem, 2.5vw, 1.8rem)',
          fontWeight: '400',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          margin: '0 0 4px 0',
          background: 'linear-gradient(90deg, #00d4ff, #a855f7, #ff6b6b)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Global Avian Influenza Tracker
        </h1>
        <p style={{ fontSize: '0.68rem', color: '#6b7280', letterSpacing: '0.06em', margin: 0 }}>
          HPAI Outbreaks & Migratory Bird Flyways
          {formattedUpdatedAt && ` • Updated ${formattedUpdatedAt}`}
          {isUsingFallbackData && ' • Fallback snapshot'}
        </p>
      </div>

      {/* Filter Controls */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 12px',
        padding: '12px 16px',
        background: 'rgba(12,20,32,0.6)',
        borderRadius: '10px',
        border: '1px solid rgba(100,150,200,0.1)',
        backdropFilter: 'blur(8px)'
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
          {/* Virus Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Virus:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {virusOptions.map(v => (
                <button key={v} onClick={() => setVirusFilter(v)} style={{
                  ...btnStyle(virusFilter === v),
                  borderColor: v !== 'all' && virusFilter === v ? getVirusColor(v) : (virusFilter === v ? '#00d4ff' : '#333'),
                  color: v !== 'all' && virusFilter === v ? getVirusColor(v) : (virusFilter === v ? '#00d4ff' : '#888')
                }}>
                  {v === 'all' ? 'All' : v}
                </button>
              ))}
            </div>
          </div>

          {/* Host Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Host:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[['all', 'All'], ['poultry', '🐔'], ['wild', '🦆'], ['dairy', '🐄'], ['human', '👤']].map(([v, label]) => (
                <button key={v} onClick={() => setHostFilter(v)} style={btnStyle(hostFilter === v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Severity Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Severity:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[['all', 'All'], ['high', 'High'], ['medium', 'Med'], ['low', 'Low']].map(([v, label]) => (
                <button key={v} onClick={() => setSeverityFilter(v)} style={{
                  ...btnStyle(severityFilter === v),
                  borderColor: v !== 'all' && severityFilter === v ? getSeverityColor(v) : (severityFilter === v ? '#00d4ff' : '#333'),
                  color: v !== 'all' && severityFilter === v ? getSeverityColor(v) : (severityFilter === v ? '#00d4ff' : '#888')
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Time Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[['all', 'All'], ['q4', 'Last 120d'], ['recent', 'Last 45d']].map(([v, label]) => (
                <button key={v} onClick={() => setTimeRange(v)} style={btnStyle(timeRange === v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Display Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Display:</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[['location', 'Summary'], ['events', 'Detailed']].map(([value, label]) => (
                <button key={value} onClick={() => setOutbreakView(value)} style={btnStyle(outbreakView === value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Labels Toggle + Data Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <button
              onClick={() => loadLiveData(true)}
              disabled={isRefreshingData}
              style={{
                ...btnStyle(isRefreshingData),
                opacity: isRefreshingData ? 0.7 : 1
              }}
            >
              {isRefreshingData ? '↻ Refreshing' : '↻ Refresh Data'}
            </button>
            <button onClick={() => setShowLabels(!showLabels)} style={btnStyle(showLabels)}>
              {showLabels ? '🏷️ Labels On' : '🏷️ Labels Off'}
            </button>
          </div>
        </div>

        {/* Active filters summary */}
        <div style={{ marginTop: '8px', fontSize: '0.55rem', color: '#4b5563' }}>
          Showing {outbreakMarkers.length} {outbreakView === 'location' ? 'locations' : 'events'}
          {' '}from {filteredOutbreaks.length} filtered outbreaks
          <span> • {outbreakView === 'location' ? 'summary mode (merged by location)' : 'detailed mode (every event)'}</span>
          <span> • Zoom {Math.round(zoomLevel * 100)}%</span>
          {virusFilter !== 'all' && <span style={{ color: getVirusColor(virusFilter) }}> • {virusFilter}</span>}
          {hostFilter !== 'all' && <span> • {getTypeIcon(hostFilter)} {hostFilter}</span>}
          {severityFilter !== 'all' && <span style={{ color: getSeverityColor(severityFilter) }}> • {severityFilter} severity</span>}
        </div>
        {dataError && (
          <div style={{ marginTop: '4px', fontSize: '0.55rem', color: '#f59e0b' }}>
            {dataError}
          </div>
        )}
        {dataWarnings.length > 0 && (
          <div style={{ marginTop: '4px', fontSize: '0.52rem', color: '#6b7280' }}>
            {liveWarningSummary}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{
        display: 'flex',
        gap: '16px',
        maxWidth: '1200px',
        margin: '0 auto',
        flexWrap: 'wrap',
        justifyContent: 'center'
      }}>
        {/* Globe */}
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '620px',
            height: '620px',
            background: 'radial-gradient(circle, rgba(0,150,200,0.06) 0%, transparent 55%)',
            borderRadius: '50%',
            pointerEvents: 'none'
          }} />

          <svg
            width={width}
            height={height}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', display: 'block', touchAction: 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <defs>
              <radialGradient id="oceanGrad" cx="30%" cy="30%">
                <stop offset="0%" stopColor="#1e3a50" />
                <stop offset="100%" stopColor="#0a1520" />
              </radialGradient>

              <clipPath id="globeClip">
                <circle cx={width / 2} cy={height / 2} r={BASE_GLOBE_SCALE} />
              </clipPath>
              
              {/* Enhanced glow filters */}
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              
              <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              
              <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>

              {/* Flyway gradients */}
              {flyways.map((fw, i) => (
                <linearGradient key={`grad-${i}`} id={`flywayGrad-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={fw.color} stopOpacity="1" />
                  <stop offset="50%" stopColor={fw.color} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={fw.color} stopOpacity="0.3" />
                </linearGradient>
              ))}
            </defs>

            {/* Atmosphere */}
            <circle cx={width / 2} cy={height / 2} r={BASE_GLOBE_SCALE + 7} fill="none" stroke="rgba(80,160,220,0.1)" strokeWidth="10" />

            {/* Ocean */}
            <circle cx={width / 2} cy={height / 2} r={BASE_GLOBE_SCALE} fill="url(#oceanGrad)" stroke="rgba(80,160,220,0.2)" strokeWidth="1" />

            <g clipPath="url(#globeClip)">
              {/* Graticule */}
              <path d={path(graticule())} fill="none" stroke="rgba(100,160,200,0.08)" strokeWidth="0.5" />

              {/* Countries */}
              {!loading && countries.map((feature, i) => (
                <path key={i} d={path(feature)} fill="#1a3328" stroke="rgba(90,160,130,0.4)" strokeWidth="0.5" />
              ))}

              {loading && (
                <text x={width / 2} y={height / 2} textAnchor="middle" fill="#666" fontSize="14">Loading map...</text>
              )}

              {/* Enhanced Flyways */}
              {showMigration && flyways.map((flyway, idx) => {
              const pathD = createFlywayPath(flyway.points);
              if (!pathD) return null;

              const isSelected = selectedFlyway === idx;
              const dashOffset = -(animationPhase * 0.5) % 100;
              const secondaryOffset = -(animationPhase * 0.3) % 80;
              
              const bird1Progress = (animationPhase / 1000) % 1;
              const bird2Progress = ((animationPhase / 1000) + 0.5) % 1;
              const bird1 = getAnimatedBird(flyway.points, bird1Progress);
              const bird2 = getAnimatedBird(flyway.points, bird2Progress);

              return (
                <g key={idx}>
                  {/* Wide outer glow */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={flyway.color}
                    strokeWidth={isSelected ? 20 : 12}
                    opacity={isSelected ? 0.15 : 0.05}
                    filter="url(#softGlow)"
                    strokeLinecap="round"
                  />
                  
                  {/* Medium glow layer */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={flyway.color}
                    strokeWidth={isSelected ? 10 : 6}
                    opacity={isSelected ? 0.25 : 0.1}
                    filter="url(#glow)"
                    strokeLinecap="round"
                  />
                  
                  {/* Base solid line - subtle */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={flyway.color}
                    strokeWidth={isSelected ? 3 : 2}
                    opacity={0.2}
                    strokeLinecap="round"
                  />
                  
                  {/* Primary animated dashes - fast moving */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={flyway.color}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray="15 10"
                    strokeDashoffset={dashOffset}
                    opacity={isSelected ? 0.9 : 0.6}
                    strokeLinecap="round"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setSelectedFlyway(idx)}
                    onMouseLeave={() => setSelectedFlyway(null)}
                  />
                  
                  {/* Secondary animated dashes - slower, offset pattern */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={flyway.color}
                    strokeWidth={isSelected ? 1.5 : 1}
                    strokeDasharray="4 20"
                    strokeDashoffset={secondaryOffset}
                    opacity={isSelected ? 0.7 : 0.4}
                    strokeLinecap="round"
                  />
                  
                  {/* Bright dots along path - particle effect */}
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map((p, i) => {
                    const dotProgress = (p + (animationPhase / 1000)) % 1;
                    const dot = getAnimatedBird(flyway.points, dotProgress);
                    if (!dot) return null;
                    return (
                      <circle
                        key={i}
                        cx={dot.x}
                        cy={dot.y}
                        r={isSelected ? 2 : 1.5}
                        fill={flyway.color}
                        opacity={0.6}
                      />
                    );
                  })}
                  
                  {/* Lead bird */}
                  {bird1 && (
                    <MigratoryBird x={bird1.x} y={bird1.y} angle={bird1.angle} color={flyway.color} size={isSelected ? 1.2 : 0.95} />
                  )}
                  
                  {/* Following bird */}
                  {bird2 && (
                    <MigratoryBird x={bird2.x} y={bird2.y} angle={bird2.angle} color={flyway.color} size={isSelected ? 1 : 0.8} />
                  )}
                </g>
              );
              })}

              {/* Outbreaks */}
              {showOutbreaks && outbreakMarkers.map((outbreak) => {
              const coords = [outbreak.lng, outbreak.lat];
              if (!isVisible(coords)) return null;
              const pt = projection(coords);
              if (!pt) return null;

              const r = getOutbreakRadius(outbreak);
              const pulse = 1 + Math.sin((animationPhase * 0.4) * Math.PI / 180) * 0.2;
              const color = getOutbreakColor(outbreak);
              const hovered = hoveredOutbreak?.id === outbreak.id;

              return (
                <g
                  key={outbreak.id}
                  onMouseEnter={() => setHoveredOutbreak(outbreak)}
                  onMouseLeave={() => setHoveredOutbreak(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={pt[0]} cy={pt[1]} r={r * pulse * 1.6} fill="none" stroke={color} strokeWidth="1" opacity={0.25} />
                  <circle cx={pt[0]} cy={pt[1]} r={r * 1.2} fill={color} opacity={0.2} filter="url(#strongGlow)" />
                  <circle cx={pt[0]} cy={pt[1]} r={r} fill={color} opacity={hovered ? 1 : 0.75} stroke="#fff" strokeWidth={hovered ? 2 : 0.5} />
                  <circle cx={pt[0]} cy={pt[1]} r={1.5} fill="#fff" />
                  
                  {/* Labels */}
                  {showLabels && (
                    <text
                      x={pt[0]}
                      y={pt[1] - r - 5}
                      textAnchor="middle"
                      fill="#fff"
                      fontSize="8"
                      fontWeight="500"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                    >
                      {outbreak.country.split(' ')[0]}
                    </text>
                  )}
                </g>
              );
              })}
            </g>

            {/* Tooltip */}
            {hoveredOutbreak && (() => {
              const coords = [hoveredOutbreak.lng, hoveredOutbreak.lat];
              if (!isVisible(coords)) return null;
              const pt = projection(coords);
              if (!pt) return null;
              const tx = pt[0] > width - 170 ? pt[0] - 165 : pt[0] + 15;
              const ty = pt[1] > height - 100 ? pt[1] - 95 : pt[1];
              const tooltipStroke = getOutbreakColor(hoveredOutbreak);
              const tooltipHeight = hoveredOutbreak.isAggregated ? 116 : 102;
              const eventLabel = hoveredOutbreak.isAggregated
                ? `${hoveredOutbreak.eventCount} merged events`
                : `${hoveredOutbreak.detections || 1} detections`;

              return (
                <g transform={`translate(${tx},${ty})`}>
                  <rect x="0" y="0" width="155" height={tooltipHeight} rx="6" fill="rgba(8,12,20,0.95)" stroke={tooltipStroke} strokeWidth="1.5" />
                  <text x="10" y="18" fill="#fff" fontSize="11" fontWeight="600">{hoveredOutbreak.country}</text>
                  <text x="10" y="34" fill={getVirusColor(hoveredOutbreak.virus)} fontSize="10" fontWeight="600">{hoveredOutbreak.virus}</text>
                  <text x="50" y="34" fill="#9ca3af" fontSize="9">{getTypeIcon(hoveredOutbreak.type)} {hoveredOutbreak.type}</text>
                  <text x="10" y="52" fill="#9ca3af" fontSize="9">📅 {hoveredOutbreak.date}</text>
                  <text x="10" y="68" fill={getSeverityColor(hoveredOutbreak.severity)} fontSize="10" fontWeight="500">{hoveredOutbreak.cases} cases</text>
                  <text x="10" y="82" fill="#6b7280" fontSize="8">{eventLabel}</text>
                  <text x="10" y="94" fill="#6b7280" fontSize="8">Severity: {hoveredOutbreak.severity.toUpperCase()}</text>
                  <text x="10" y="107" fill="#6b7280" fontSize="7">{hoveredOutbreak.source || 'Source unavailable'}</text>
                </g>
              );
            })()}
          </svg>

          {/* Globe Controls */}
          <div style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '6px',
            background: 'rgba(0,0,0,0.5)',
            padding: '5px 8px',
            borderRadius: '14px',
            backdropFilter: 'blur(8px)'
          }}>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              disabled={isZoomedIn}
              style={{
                ...btnStyle(autoRotate && !isZoomedIn),
                opacity: isZoomedIn ? 0.45 : 1,
                cursor: isZoomedIn ? 'not-allowed' : 'pointer'
              }}
            >
              {isZoomedIn ? '🔍 Zoomed' : (autoRotate ? '⏸ Pause' : '▶ Spin')}
            </button>
            <button
              onClick={() => { setRotation([0, -20, 0]); setZoomLevel(1); setAutoRotate(true); }}
              style={btnStyle(false)}
            >
              ↺ Reset
            </button>
            <button onClick={() => updateZoomLevel(zoomLevel / 1.25)} style={btnStyle(false)}>
              －
            </button>
            <button onClick={() => updateZoomLevel(zoomLevel * 1.25)} style={btnStyle(false)}>
              ＋
            </button>
            <button onClick={() => setShowMigration(!showMigration)} style={btnStyle(showMigration)}>
              🦅
            </button>
            <button onClick={() => setShowOutbreaks(!showOutbreaks)} style={btnStyle(showOutbreaks)}>
              ⬡
            </button>
          </div>
        </div>

        {/* Side Panel */}
        <div style={{
          flex: '0 0 240px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '620px',
          overflowY: 'auto'
        }}>
          {/* Flyways Legend */}
          <div style={{
            background: 'rgba(12,20,32,0.7)',
            borderRadius: '8px',
            border: '1px solid rgba(100,150,200,0.1)',
            padding: '10px',
            backdropFilter: 'blur(8px)'
          }}>
            <h3 style={{ fontSize: '0.55rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px 0' }}>
              Migratory Flyways
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {flyways.map((flyway, idx) => (
                <div
                  key={idx}
                  onMouseEnter={() => setSelectedFlyway(idx)}
                  onMouseLeave={() => setSelectedFlyway(null)}
                  style={{
                    padding: '5px 7px',
                    background: selectedFlyway === idx ? `${flyway.color}15` : 'transparent',
                    borderRadius: '4px',
                    borderLeft: `2px solid ${flyway.color}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                >
                  <div style={{ fontSize: '0.65rem', fontWeight: '600', color: flyway.color }}>{flyway.name}</div>
                  <div style={{ fontSize: '0.5rem', color: '#6b7280' }}>{flyway.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Virus Legend */}
          <div style={{
            background: 'rgba(12,20,32,0.7)',
            borderRadius: '8px',
            border: '1px solid rgba(100,150,200,0.1)',
            padding: '10px',
            backdropFilter: 'blur(8px)'
          }}>
            <h3 style={{ fontSize: '0.55rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px 0' }}>
              Virus Strains
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[['H5N1', 'Primary strain'], ['H5N5', 'Europe variant'], ['H9N2', 'Asia endemic'], ['H7N9', 'China origin']].map(([v, desc]) => (
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getVirusColor(v), boxShadow: `0 0 4px ${getVirusColor(v)}50` }} />
                  <span style={{ fontSize: '0.55rem', color: getVirusColor(v), fontWeight: '600' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div style={{
            background: 'rgba(12,20,32,0.7)',
            borderRadius: '8px',
            border: '1px solid rgba(100,150,200,0.1)',
            padding: '10px',
            backdropFilter: 'blur(8px)'
          }}>
            <h3 style={{ fontSize: '0.55rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px 0' }}>
              Statistics
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: '300', color: '#ff2d55' }}>
                  {compactNumber.format(stats.totalCases || 0)}
                </div>
                <div style={{ fontSize: '0.48rem', color: '#6b7280' }}>Total Cases</div>
              </div>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: '300', color: '#00d4ff' }}>
                  {standardNumber.format(stats.countriesCount || 0)}
                </div>
                <div style={{ fontSize: '0.48rem', color: '#6b7280' }}>Countries</div>
              </div>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: '300', color: '#f59e0b' }}>
                  {compactNumber.format(stats.usLivestockCases || 0)}
                </div>
                <div style={{ fontSize: '0.48rem', color: '#6b7280' }}>US Livestock</div>
              </div>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: '300', color: '#a855f7' }}>
                  {standardNumber.format(stats.humanCases || 0)}
                </div>
                <div style={{ fontSize: '0.48rem', color: '#6b7280' }}>Human Cases</div>
              </div>
            </div>
          </div>

          {/* Severity Legend */}
          <div style={{
            background: 'rgba(12,20,32,0.7)',
            borderRadius: '8px',
            border: '1px solid rgba(100,150,200,0.1)',
            padding: '10px',
            backdropFilter: 'blur(8px)'
          }}>
            <h3 style={{ fontSize: '0.55rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px 0' }}>
              Severity / Hosts
            </h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
              {[['HIGH', '#ff2d55'], ['MED', '#ff9500'], ['LOW', '#ffcc00']].map(([l, c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c }} />
                  <span style={{ fontSize: '0.5rem', color: c }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[['🐔', 'Poultry'], ['🦆', 'Wild'], ['🐄', 'Dairy'], ['👤', 'Human']].map(([i, l]) => (
                <span key={l} style={{ fontSize: '0.5rem', color: '#6b7280' }}>{i} {l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '10px', padding: '8px' }}>
        <p style={{ fontSize: '0.52rem', color: '#4b5563', margin: 0 }}>
          🖱️ Drag to rotate • Wheel/pinch to zoom • Data: USDA + OWID (WHO human case feed), cached up to 12h • Flyways: BirdLife International
        </p>
      </div>
    </div>
  );
};

export default FluGlobeVisualization;
