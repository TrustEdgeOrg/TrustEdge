import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import VpnLockIcon from '@mui/icons-material/VpnLock';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudIcon from '@mui/icons-material/Cloud';
import { countryFlagEmoji, countryLabel } from '../../devices/utils/countryDisplay';
import { VPN_GATEWAY_COUNTRY, VPN_GATEWAY_LABEL } from '../../../shared/config/vpnGateway';
import { useVpnTopology } from '../../vpn/hooks/useVpnTopology';
import { HandshakeStatus } from '../../vpn/types/topology';
import { formatBytesCompact } from '../utils/formatBandwidth';

interface VpnGatewayDialogProps {
  open: boolean;
  onClose: () => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={500}
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function truncateKey(key: string, head = 12, tail = 8): string {
  if (key.length <= head + tail + 3) {
    return key;
  }
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

function countByStatus(peers: { handshake_status: HandshakeStatus }[], status: HandshakeStatus): number {
  return peers.filter((p) => p.handshake_status === status).length;
}

function parseEndpointHost(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return '—';
  }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 0 ? trimmed.slice(1, end) : trimmed;
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && trimmed.slice(colon + 1).match(/^\d+$/)) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export default function VpnGatewayDialog({ open, onClose }: VpnGatewayDialogProps) {
  const { topology, loading, error, refetch } = useVpnTopology(open);
  const server = topology?.server;
  const peers = topology?.peers ?? [];

  const connected = countByStatus(peers, 'connected');
  const idle = countByStatus(peers, 'idle');
  const never = countByStatus(peers, 'never');
  const onWireguard = peers.filter((p) => p.on_wireguard).length;

  const totalRx = peers.reduce((sum, p) => sum + (p.rx_bytes ?? 0), 0);
  const totalTx = peers.reduce((sum, p) => sum + (p.tx_bytes ?? 0), 0);

  const regionLabel = countryLabel(VPN_GATEWAY_COUNTRY, null);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <VpnLockIcon color="warning" sx={{ mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="div">
              {VPN_GATEWAY_LABEL}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              TrustEdge WireGuard gateway on EC2 · {countryFlagEmoji(VPN_GATEWAY_COUNTRY)} {regionLabel}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Stack alignItems="center" py={3}>
            <CircularProgress size={28} />
          </Stack>
        )}

        {!loading && error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && server && (
          <Stack spacing={2}>
            <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
              <Chip size="small" icon={<CloudIcon />} label="EC2 host" variant="outlined" />
              <Chip size="small" label={`${peers.length} enrolled peer${peers.length === 1 ? '' : 's'}`} variant="outlined" />
              <Chip size="small" label={`${connected} connected`} color="success" variant="outlined" />
              {idle > 0 && <Chip size="small" label={`${idle} idle`} variant="outlined" />}
              {never > 0 && <Chip size="small" label={`${never} never connected`} variant="outlined" />}
            </Stack>

            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Public endpoint
              </Typography>
              <DetailRow label="WireGuard" value={server.endpoint || '—'} />
              <DetailRow label="Public host" value={parseEndpointHost(server.endpoint)} />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Tunnel &amp; DNS
              </Typography>
              <DetailRow label="Interface" value={server.interface || 'wg0'} />
              <DetailRow label="Gateway IP" value={server.gateway_ip || '—'} />
              <DetailRow label="DNS (policy)" value={server.dns_ip || '—'} />
              <DetailRow label="Client pool" value={server.cidr || '—'} />
              {server.mtu != null && <DetailRow label="MTU" value={String(server.mtu)} />}
              <DetailRow label="Allowed IPs" value={server.allowed_ips.join(', ') || '—'} />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Server identity
              </Typography>
              <DetailRow label="Public key" value={truncateKey(server.server_public_key)} />
              <DetailRow label="On WireGuard" value={`${onWireguard} / ${peers.length} peers`} />
              {(totalRx > 0 || totalTx > 0) && (
                <DetailRow
                  label="Peer traffic"
                  value={`↓ ${formatBytesCompact(totalRx)} · ↑ ${formatBytesCompact(totalTx)} (cumulative)`}
                />
              )}
            </Box>

            <Typography variant="caption" color="text.secondary">
              Host services: wireguard-go / wg0, dnsmasq, trustedge-wg-agent. Control plane runs in Docker on
              this instance.
            </Typography>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button startIcon={<RefreshIcon />} onClick={() => refetch()} disabled={loading}>
          Refresh
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
