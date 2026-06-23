import { lazy, Suspense } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import { Link as RouterLink } from 'react-router-dom';
import HubIcon from '@mui/icons-material/Hub';

const NetworkAttributionMapGraph = lazy(
  () => import('../features/network-map/components/NetworkAttributionMapGraph'),
);

export default function NetworkMapPage() {
  return (
    <Box sx={{ maxWidth: 1200 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'flex-start' }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography component="h1" variant="h5" sx={{ mb: 0.5, fontWeight: 600 }}>
            Network map
          </Typography>
          <Typography variant="body2" color="text.secondary">
            See which foreground process on each device triggered recent DNS and network activity.
          </Typography>
        </Box>
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ flexShrink: 0 }}>
          <Chip size="small" variant="outlined" icon={<HubIcon />} label="Attribution view" />
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.75 }}>
          How to read this map
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          TrustEdge correlates live DNS queries with the macOS foreground app reported by the VPN client.
          Each arc is logical attribution—not a packet capture—but it answers:{' '}
          <em>which app was active when this DNS lookup happened?</em>
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Teal device = endpoint" />
          <Chip size="small" variant="outlined" label="Center = process icon" />
          <Chip size="small" variant="outlined" label="Right = DNS destination" />
          <Chip
            size="small"
            variant="outlined"
            label="Green ring = fresh foreground context"
            sx={{ borderColor: 'success.main', color: 'success.main' }}
          />
          <Chip
            size="small"
            variant="outlined"
            label="Red destination = blocked query"
            sx={{ borderColor: 'error.main', color: 'error.main' }}
          />
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          <Button component={RouterLink} to="/client-map" size="small" variant="outlined">
            Geographic client map
          </Button>
          <Button component={RouterLink} to="/client-profiles" size="small" variant="text">
            Client profiles
          </Button>
        </Stack>
      </Paper>

      <Suspense
        fallback={
          <Paper variant="outlined" sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={32} />
          </Paper>
        }
      >
        <NetworkAttributionMapGraph showHeader={false} />
      </Suspense>
    </Box>
  );
}
