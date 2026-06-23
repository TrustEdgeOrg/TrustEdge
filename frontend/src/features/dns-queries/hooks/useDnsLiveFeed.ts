import { useState, useEffect, useRef, useCallback } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { recordDnsClientActivity } from '../dnsClientActivity';

export interface LiveDnsQuery {
  timestamp: string;
  client_ip: string;
  domain: string;
  query_type: string | null;
  action: string | null;
  blocked: boolean;
  attributed_app_slug?: string | null;
  attributed_app_display_name?: string | null;
}

interface WebSocketMessage {
  type: string;
  queries: LiveDnsQuery[];
}

const MAX_FEED_SIZE = 200;
const RECONNECT_DELAY = 3000;
const PING_INTERVAL = 25000; // Send ping every 25 seconds to keep connection alive

export function useDnsLiveFeed() {
  const [feed, setFeed] = useState<LiveDnsQuery[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPausedRef = useRef(isPaused);

  // Keep ref in sync with state
  isPausedRef.current = isPaused;

  const stopPing = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const startPing = useCallback(() => {
    stopPing();
    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, PING_INTERVAL);
  }, [stopPing]);

  const connect = useCallback(() => {
    // Don't reconnect if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = getDnsQueriesWebSocketUrl();
    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        console.log('[LiveFeed] WebSocket connected to', wsUrl);
        startPing(); // Start keepalive pings
      };

      ws.onmessage = (event) => {
        try {
          const raw = event.data;
          // Ignore pong responses
          if (raw === 'pong') return;

          const data: WebSocketMessage = JSON.parse(raw);
          if (data.type === 'dns_queries' && data.queries?.length > 0) {
            recordDnsClientActivity(data.queries);
            // Only update feed if not paused
            if (!isPausedRef.current) {
              setFeed((prev) => {
                const updated = [...data.queries, ...prev];
                // Trim to max size
                return updated.slice(0, MAX_FEED_SIZE);
              });
            }
          }
        } catch (e) {
          console.warn('[LiveFeed] Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        setConnectionStatus('disconnected');
        wsRef.current = null;
        stopPing(); // Stop pings on disconnect
        console.log('[LiveFeed] WebSocket disconnected:', event.code, event.reason);

        // Auto-reconnect unless intentionally closed
        if (event.code !== 1000) {
          setConnectionStatus('reconnecting');
          reconnectTimerRef.current = setTimeout(() => {
            console.log('[LiveFeed] Reconnecting...');
            connect();
          }, RECONNECT_DELAY);
        }
      };

      ws.onerror = (error) => {
        console.error('[LiveFeed] WebSocket error:', error);
      };
    } catch (e) {
      console.error('[LiveFeed] Failed to create WebSocket:', e);
      setConnectionStatus('disconnected');
    }
  }, [startPing, stopPing]);

  const disconnect = useCallback(() => {
    stopPing();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [stopPing]);

  const clearFeed = useCallback(() => {
    setFeed([]);
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    feed,
    isConnected,
    isPaused,
    connectionStatus,
    togglePause,
    clearFeed,
    connect,
    disconnect,
  };
}
