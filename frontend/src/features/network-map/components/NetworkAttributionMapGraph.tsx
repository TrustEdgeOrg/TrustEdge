import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { alpha, useTheme } from '@mui/material/styles';
import HubIcon from '@mui/icons-material/Hub';
import { useNetworkAttributionMap } from '../hooks/useNetworkAttributionMap';
import { edgePath, layoutNetworkMap } from '../utils/layoutNetworkMap';
import { getAppIconStyle, getDeviceIconStyle, getDomainIconStyle } from '../utils/appIcons';
import { NetworkMapEdge, PositionedNode } from '../types/networkMap';

const NODE_W = 36;

function MapNodeGlyph({ node }: { node: PositionedNode }) {
  const theme = useTheme();
  const style =
    node.type === 'device'
      ? getDeviceIconStyle()
      : node.type === 'app'
        ? getAppIconStyle(node.app_slug)
        : getDomainIconStyle(node.blocked);

  const ring =
    node.type === 'device' && node.fresh
      ? theme.palette.success.main
      : node.type === 'domain' && node.blocked
        ? theme.palette.error.main
        : style.color;

  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <title>
        {node.type === 'app'
          ? `${node.label} (foreground process)`
          : node.type === 'domain'
            ? `${node.label}${node.blocked ? ' · blocked' : ''}`
            : `${node.label}${node.client_ip ? ` · ${node.client_ip}` : ''}`}
      </title>
      <circle
        r={NODE_W / 2 + 4}
        fill={theme.palette.background.paper}
        stroke={ring}
        strokeWidth={node.type === 'device' && node.fresh ? 2 : 1.25}
      />
      <circle r={NODE_W / 2} fill={style.bg} />
      <foreignObject x={-10} y={-10} width={20} height={20} style={{ pointerEvents: 'none' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: style.color }}>
          {style.icon}
        </Box>
      </foreignObject>
      <text
        textAnchor="middle"
        y={NODE_W / 2 + 14}
        fontSize={10}
        fontWeight={600}
        fill={theme.palette.text.primary}
        style={{ pointerEvents: 'none' }}
      >
        {node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label}
      </text>
    </g>
  );
}

function edgeTooltip(edge: NetworkMapEdge, nodes: Map<string, PositionedNode>): string {
  const source = nodes.get(edge.source)?.label ?? edge.source;
  const target = nodes.get(edge.target)?.label ?? edge.target;
  if (edge.kind === 'foreground') {
    return `${source} → ${target} (foreground app)`;
  }
  const blocked = edge.blocked_count > 0 ? ` · ${edge.blocked_count} blocked` : '';
  return `${source} → ${target} · ${edge.query_count} DNS quer${edge.query_count === 1 ? 'y' : 'ies'}${blocked}`;
}

interface NetworkAttributionMapGraphProps {
  minutes?: number;
  showHeader?: boolean;
}

export default function NetworkAttributionMapGraph({
  minutes = 15,
  showHeader = true,
}: NetworkAttributionMapGraphProps) {
  const theme = useTheme();
  const { data, loading, error, liveConnected } = useNetworkAttributionMap(minutes);

  const layout = useMemo(() => {
    if (!data) {
      return null;
    }
    return layoutNetworkMap(data.nodes, data.edges);
  }, [data]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    layout?.nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [layout]);

  const deviceCount = data?.nodes.filter((n) => n.type === 'device').length ?? 0;
  const appCount = data?.nodes.filter((n) => n.type === 'app').length ?? 0;
  const domainCount = data?.nodes.filter((n) => n.type === 'domain').length ?? 0;

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      {showHeader && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <HubIcon color="primary" fontSize="small" />
          <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
            Network attribution map
          </Typography>
          {liveConnected && (
            <Chip size="small" label="Live DNS" color="success" variant="outlined" sx={{ height: 24 }} />
          )}
        </Stack>
      )}

      <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
        <Chip size="small" variant="outlined" label={`${deviceCount} devices`} />
        <Chip size="small" variant="outlined" label={`${appCount} apps`} />
        <Chip size="small" variant="outlined" label={`${domainCount} destinations`} />
        {data && (
          <Chip size="small" variant="outlined" label={`Last ${data.minutes} min`} />
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        Device → foreground process → DNS destination. Process icons come from macOS endpoint telemetry.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          position: 'relative',
          borderRadius: 1,
          overflow: 'auto',
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.06 : 0.03),
          minHeight: 280,
        }}
      >
        {loading && !layout && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 280 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {layout && (
          <Box
            component="svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            sx={{ width: '100%', minWidth: 640, height: 'auto', display: 'block' }}
            role="img"
            aria-label="Network attribution map showing devices, foreground apps, and DNS destinations"
          >
            <text x={COL_LABELS.device} y={24} textAnchor="middle" fontSize={11} fontWeight={700} fill={theme.palette.text.secondary}>
              Devices
            </text>
            <text x={COL_LABELS.app} y={24} textAnchor="middle" fontSize={11} fontWeight={700} fill={theme.palette.text.secondary}>
              Processes
            </text>
            <text x={COL_LABELS.domain} y={24} textAnchor="middle" fontSize={11} fontWeight={700} fill={theme.palette.text.secondary}>
              Destinations
            </text>

            {layout.edges.map((edge) => {
              const from = nodeMap.get(edge.source);
              const to = nodeMap.get(edge.target);
              if (!from || !to) {
                return null;
              }
              const x1 = from.x + NODE_W / 2;
              const x2 = to.x - NODE_W / 2;
              const stroke =
                edge.kind === 'foreground'
                  ? theme.palette.info.main
                  : edge.blocked_count > 0
                    ? theme.palette.error.main
                    : theme.palette.success.main;
              return (
                <path
                  key={`${edge.source}-${edge.target}-${edge.kind}`}
                  d={edgePath(x1, from.y, x2, to.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={edge.kind === 'dns' ? Math.min(4, 1 + Math.log2(edge.query_count + 1)) : 1.5}
                  opacity={edge.kind === 'foreground' ? 0.55 : 0.75}
                  strokeLinecap="round"
                >
                  <title>{edgeTooltip(edge, nodeMap)}</title>
                </path>
              );
            })}

            {layout.nodes.map((node) => (
              <MapNodeGlyph key={node.id} node={node} />
            ))}
          </Box>
        )}

        {!loading && layout && layout.nodes.length === 0 && (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The network map only shows DNS that is <strong>attributed to a foreground app</strong> on
              the Mac — not every query in Live DNS.
            </Typography>
            <Typography variant="body2" color="text.secondary" component="ul" sx={{ pl: 2.25, m: 0 }}>
              <li>
                In <strong>Live DNS</strong>, do rows show an app chip (e.g. Safari, Chrome)? If not,
                the Mac client is not reporting foreground apps yet.
              </li>
              <li>
                Rebuild and reinstall <strong>TrustEdge.app</strong> from the network-attribution
                branch, reconnect VPN, and browse in a foreground app for 1–2 minutes.
              </li>
              <li>
                Check <strong>Client profiles → Network attribution</strong> for per-app usage rows.
              </li>
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

const COL_LABELS = {
  device: 90,
  app: 340,
  domain: 620,
};
