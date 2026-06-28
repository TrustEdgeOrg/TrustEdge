import { useCallback, useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { twinApi } from '../config/api';
import { PackToggleSimulationResponse } from '../types/twinSimulation';
import { PolicyPack } from '../../policy/types/policy';
import { formatShortDateTime } from '../../../shared/utils/dateUtils';

interface PackTogglePreviewDialogProps {
  pack: PolicyPack | null;
  open: boolean;
  onClose: () => void;
  onApply: (pack: PolicyPack, enabledGlobally: boolean) => Promise<void>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={600}>
        {value}
      </Typography>
    </Paper>
  );
}

export default function PackTogglePreviewDialog({
  pack,
  open,
  onClose,
  onApply,
}: PackTogglePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PackToggleSimulationResponse | null>(null);

  const proposedEnabled = pack ? !pack.enabled_globally : false;

  const loadPreview = useCallback(async () => {
    if (!pack) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await twinApi.simulatePackToggle({
        pack_slug: pack.slug,
        enabled_globally: proposedEnabled,
      });
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Failed to load simulation');
    } finally {
      setLoading(false);
    }
  }, [pack, proposedEnabled]);

  useEffect(() => {
    if (open && pack) {
      loadPreview();
    } else {
      setResult(null);
      setError(null);
    }
  }, [open, pack, loadPreview]);

  const handleApply = async () => {
    if (!pack) {
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await onApply(pack, proposedEnabled);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply policy change');
    } finally {
      setApplying(false);
    }
  };

  if (!pack) {
    return null;
  }

  const actionLabel = proposedEnabled ? 'Enable enforcement' : 'Disable enforcement';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Preview impact — {pack.name}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Simulated change: turn this pack {proposedEnabled ? 'on' : 'off'} network-wide. Based on DNS
          activity observed in the last {result?.lookback_hours ?? 24} hours.
        </Typography>

        {loading && (
          <Stack alignItems="center" sx={{ py: 4 }}>
            <CircularProgress size={32} />
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {result && !loading && (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <SummaryCard label="Devices affected" value={result.summary.devices_affected} />
              <SummaryCard
                label="New block domains"
                value={result.summary.newly_blocked_domain_count}
              />
              <SummaryCard label="Recent 24h hits" value={result.summary.recent_hits_count} />
            </Stack>

            {result.summary.recent_hits_count === 0 ? (
              <Alert severity="info">
                No matching DNS activity in the lookback window would be newly affected.
              </Alert>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Domain</TableCell>
                    <TableCell>Device</TableCell>
                    <TableCell>Last seen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.summary.recent_hits_sample.map((hit) => (
                    <TableRow key={`${hit.device_id}-${hit.root_domain}-${hit.last_seen_at}`}>
                      <TableCell>{hit.root_domain}</TableCell>
                      <TableCell>{hit.hostname || `Device ${hit.device_id}`}</TableCell>
                      <TableCell>{formatShortDateTime(hit.last_seen_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleApply}
          disabled={loading || applying || !!error}
        >
          {applying ? 'Applying…' : actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
