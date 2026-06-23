import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import BlockIcon from '@mui/icons-material/Block';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DNS_QUERY_ENDPOINTS } from '../../dns-queries/config/api';
import { DnsQuery, DnsQueryPaginatedResponse } from '../../dns-queries/types/dnsQuery';
import { formatShortDateTime } from '../../../shared/utils/dateUtils';
import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';

function BlockedAttemptRow({ item }: { item: DnsQuery }) {
  const machineName = item.device_name || 'Unknown device';
  const machineMeta = item.device_vendor ? `${item.device_vendor} - ${item.client_ip}` : item.client_ip;

  return (
    <ListItem sx={{ py: 0.75, px: 1.5 }}>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {item.domain}
            </Typography>
            <Chip label={item.query_type || 'A'} size="small" variant="outlined" />
            <Chip label="Blocked" size="small" color="error" variant="outlined" />
            {item.attributed_app_display_name && (
              <Tooltip title="Attributed to foreground app at query time (endpoint telemetry)">
                <Chip label={item.attributed_app_display_name} size="small" variant="outlined" />
              </Tooltip>
            )}
          </Stack>
        }
        secondary={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.25, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {formatShortDateTime(item.timestamp)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {machineName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {machineMeta}
            </Typography>
          </Stack>
        }
      />
    </ListItem>
  );
}

export default function BlockedAttemptsView() {
  const [items, setItems] = useState<DnsQuery[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBlockedAttempts = useCallback(async () => {
    setLoading(true);
    try {
      const url = DNS_QUERY_ENDPOINTS.dnsQueries({
        page: 1,
        page_size: 20,
        blocked_only: true,
      });
      const response = await fetch(url, { headers: getAdminAuthHeaders() });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: DnsQueryPaginatedResponse = await response.json();
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      console.error('Failed to fetch blocked attempts:', error);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlockedAttempts();
  }, [fetchBlockedAttempts]);

  return (
    <Paper
      variant="outlined"
      sx={{
        height: '100%',
        minHeight: 280,
        maxHeight: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <BlockIcon color="error" fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Recent Blocked Attempts
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {total.toLocaleString()} total
        </Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={fetchBlockedAttempts} disabled={loading}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading && items.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 220 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 220, px: 2 }}>
            <Typography variant="body2" color="text.secondary">
              No blocked attempts found yet.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {items.map((item, idx) => (
              <Box key={`${item.id}-${item.timestamp}`}>
                <BlockedAttemptRow item={item} />
                {idx < items.length - 1 && <Divider component="li" />}
              </Box>
            ))}
          </List>
        )}
      </Box>
    </Paper>
  );
}
