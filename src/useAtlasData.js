import {useState, useCallback, useEffect} from 'react';
export default function useAtlasData() {
const LIVE_DATA_CACHE_KEY = 'fluglobe-live-data-v1';
  const [liveOutbreakData, setLiveOutbreakData] = useState([]);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null);
  const [dataWarnings, setDataWarnings] = useState([]);
  const [dataError, setDataError] = useState('');
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [isUsingFallbackData, setIsUsingFallbackData] = useState(true);
  const loadLiveData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshingData(true);
      setDataError('');
    }

    let cached = null;
    try {
      const raw = localStorage.getItem(LIVE_DATA_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {
      cached = null;
    }

    const hasCachedOutbreaks = Array.isArray(cached?.outbreaks) && cached.outbreaks.length > 0;
    if (hasCachedOutbreaks) {
      setLiveOutbreakData(cached.outbreaks);
      setDataUpdatedAt(cached.generatedAt || null);
      setDataWarnings(cached.warnings || []);
      setIsUsingFallbackData(false);
    }

    // Initial page load should never auto-refresh from the network.
    if (!forceRefresh) {
      return;
    }

    try {
      const query = forceRefresh ? `?force=1&t=${Date.now()}` : '';
      const response = await fetch(`/api/flu-data${query}`);
      if (!response.ok) {
        throw new Error(`Live data request failed (${response.status})`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload?.outbreaks) || payload.outbreaks.length === 0) {
        const details = Array.isArray(payload?.warnings) ? payload.warnings.join(' ') : '';
        throw new Error(`No source records returned for the requested time window.${details ? ` ${details}` : ''}`);
      }

      setLiveOutbreakData(payload.outbreaks);
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
      if (hasCachedOutbreaks) {
        setLiveOutbreakData(cached.outbreaks);
        setDataUpdatedAt(cached.generatedAt || null);
        setDataWarnings([
          ...new Set([...(cached.warnings || []), 'Using last cached live data due to refresh failure.'])
        ]);
        setIsUsingFallbackData(false);
      } else {
        setLiveOutbreakData([]);
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

return {liveOutbreakData,dataUpdatedAt,dataWarnings,dataError,isRefreshingData,isUsingFallbackData,loadLiveData};
}
