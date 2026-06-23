import { lazy, Suspense, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import CircularProgress from '@mui/material/CircularProgress';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useLiveClients } from '../features/dashboard/hooks/useLiveClients';
import ClientMapIntro from '../features/dashboard/components/ClientMapIntro';

const ClientWorldMap = lazy(() => import('../features/dashboard/components/ClientWorldMap'));

export default function ClientMapPage() {
  const live = useLiveClients();
  const [showTrafficFlows, setShowTrafficFlows] = useState(true);

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
            Client map
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Geographic view of VPN login locations and live tunnel activity to your gateway.
          </Typography>
        </Box>
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showTrafficFlows}
                onChange={(_, checked) => setShowTrafficFlows(checked)}
              />
            }
            label="Traffic flows"
            sx={{ mr: 0 }}
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={live.refetch}
            disabled={live.loading}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      <ClientMapIntro />

      <Suspense
        fallback={
          <Paper variant="outlined" sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={32} />
          </Paper>
        }
      >
        <ClientWorldMap
          clients={live.mapClients}
          loading={live.loading}
          showHeader={false}
          showTrafficFlows={showTrafficFlows}
        />
      </Suspense>
    </Box>
  );
}
