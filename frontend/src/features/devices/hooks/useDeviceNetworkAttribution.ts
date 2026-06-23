import { useCallback, useEffect, useState } from 'react';
import { devicesApi } from '../config/api';
import { AppUsageSummaryResponse } from '../types/device';

export function useDeviceNetworkAttribution(deviceId: number, hours = 168) {
  const [data, setData] = useState<AppUsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await devicesApi.getNetworkAttributionSummary(deviceId, hours);
      setData(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load network attribution');
    } finally {
      setLoading(false);
    }
  }, [deviceId, hours]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
