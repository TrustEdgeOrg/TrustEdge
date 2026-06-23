import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import AppsIcon from '@mui/icons-material/Apps';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { Link as RouterLink } from 'react-router-dom';
import Button from '@mui/material/Button';
import { getAppIconStyle } from '../../network-map/utils/appIcons';

interface NetworkAttributionSectionProps {
  deviceId: number;
}

export default function NetworkAttributionSection({ deviceId }: NetworkAttributionSectionProps) {
  const { data, loading, error } = useDeviceNetworkAttribution(deviceId, 168);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
        <AppsIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Network attribution (last 7 days)
        </Typography>
        <Tooltip
          title="Foreground application time while VPN was connected. Hourly averages from endpoint telemetry. DNS blocks may show which app was active at query time."
          arrow
        >
          <Box
            component="span"
            aria-label="About network attribution"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'help',
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            <HelpOutlineIcon sx={{ fontSize: 18 }} />
          </Box>
        </Tooltip>
      </Stack>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        </Box>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {!loading && !error && data && data.items.length === 0 && (
        <Alert severity="info" variant="outlined">
          No application usage reported yet. Connect with TrustEdge.app on macOS while VPN is active.
        </Alert>
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Application</TableCell>
              <TableCell align="right">Avg min / hour</TableCell>
              <TableCell align="right">Total hours</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={item.app_slug}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: getAppIconStyle(item.app_slug).bg,
                        color: getAppIconStyle(item.app_slug).color,
                      }}
                    >
                      {getAppIconStyle(item.app_slug).icon}
                    </Box>
                    <Typography variant="body2">{item.app_display_name}</Typography>
                    {['microsoft_teams', 'zoom', 'slack'].includes(item.app_slug) && (
                      <Chip label="Collab" size="small" variant="outlined" />
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">{item.avg_active_minutes_per_hour.toFixed(1)}</TableCell>
                <TableCell align="right">{item.total_active_hours.toFixed(1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Button component={RouterLink} to="/network-map" size="small" sx={{ mt: 1 }}>
        View full network map
      </Button>
    </Box>
  );
}
