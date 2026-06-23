import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useDnsLiveFeed, LiveDnsQuery } from '../../dns-queries/hooks/useDnsLiveFeed';
import { formatTime } from '../../../shared/utils/dateUtils';
import { getAppIconStyle } from '../../network-map/utils/appIcons';

function QueryRow({ query }: { query: LiveDnsQuery }) {
  const appStyle = query.attributed_app_display_name
    ? getAppIconStyle(query.attributed_app_slug)
    : null;

  return (
    <ListItem
      sx={{
        py: 0.5,
        px: 1.5,
        backgroundColor: query.blocked ? 'rgba(211, 47, 47, 0.06)' : 'transparent',
        '&:hover': {
          backgroundColor: query.blocked ? 'rgba(211, 47, 47, 0.1)' : 'action.hover',
        },
        transition: 'background-color 0.2s',
      }}
    >
      <ListItemText
        primary={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                color: 'text.secondary',
                minWidth: 70,
                flexShrink: 0,
              }}
            >
              {formatTime(query.timestamp)}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {query.domain}
            </Typography>
            {appStyle && query.attributed_app_display_name && (
              <Tooltip title="Attributed to foreground app at query time (endpoint telemetry)">
                <Chip
                  size="small"
                  variant="outlined"
                  icon={
                    <Box component="span" sx={{ display: 'flex', color: appStyle.color, ml: 0.5 }}>
                      {appStyle.icon}
                    </Box>
                  }
                  label={query.attributed_app_display_name}
                  sx={{ maxWidth: 140, flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                color: 'text.secondary',
                minWidth: 85,
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              {query.client_ip}
            </Typography>
            <Chip
              label={query.blocked ? 'Blocked' : 'Allowed'}
              color={query.blocked ? 'error' : 'success'}
              size="small"
              variant="outlined"
              sx={{ minWidth: 70, flexShrink: 0 }}
            />
          </Stack>
        }
      />
    </ListItem>
  );
}

export default function DnsLiveFeed() {
  const {
    feed,
    isConnected,
    isPaused,
    connectionStatus,
    togglePause,
    clearFeed,
  } = useDnsLiveFeed();

  const statusColor = useMemo(() => {
    switch (connectionStatus) {
      case 'connected':
        return 'success.main';
      case 'connecting':
      case 'reconnecting':
        return 'warning.main';
      case 'disconnected':
        return 'error.main';
      default:
        return 'text.disabled';
    }
  }, [connectionStatus]);

  const statusLabel = useMemo(() => {
    switch (connectionStatus) {
      case 'connected':
        return 'Live';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  }, [connectionStatus]);

  return (
    <Paper variant="outlined" sx={{ height: 400, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <FiberManualRecordIcon
          sx={{
            fontSize: 12,
            color: statusColor,
            animation: isConnected ? 'pulse 2s infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Live DNS Feed
        </Typography>
        <Chip
          label={statusLabel}
          size="small"
          color={isConnected ? 'success' : 'default'}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: 20 }}
        />

        <Box sx={{ flex: 1 }} />

        {isPaused && (
          <Chip
            label="Paused"
            size="small"
            color="warning"
            variant="filled"
            sx={{ fontSize: '0.7rem', height: 20 }}
          />
        )}

        <Typography variant="caption" color="text.secondary">
          {feed.length} entries
        </Typography>

        <Tooltip title={isPaused ? 'Resume' : 'Pause'}>
          <IconButton size="small" onClick={togglePause}>
            {isPaused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear feed">
          <IconButton size="small" onClick={clearFeed}>
            <DeleteSweepIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Feed content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {feed.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              color: 'text.secondary',
            }}
          >
            <Typography variant="body2">
              {isConnected
                ? 'Waiting for DNS queries...'
                : 'Connecting to live feed...'}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {feed.map((query, index) => (
              <Box key={`${query.timestamp}-${query.domain}-${index}`}>
                <QueryRow query={query} />
                {index < feed.length - 1 && <Divider component="li" />}
              </Box>
            ))}
          </List>
        )}
      </Box>
    </Paper>
  );
}
