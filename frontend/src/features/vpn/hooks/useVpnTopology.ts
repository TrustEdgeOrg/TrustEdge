import { useCallback, useEffect, useState } from 'react';
import { vpnApi } from '../config/api';
import { VpnTopology } from '../types/topology';

export function useVpnTopology(enabled: boolean) {
  const [topology, setTopology] = useState<VpnTopology | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTopology = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await vpnApi.getTopology();
      setTopology(data);
    } catch (e) {
      setTopology(null);
      setError(e instanceof Error ? e.message : 'Failed to load VPN topology');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    fetchTopology();
  }, [enabled, fetchTopology]);

  return { topology, loading, error, refetch: fetchTopology };
}
