import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import HubIcon from '@mui/icons-material/Hub';
import { useNetworkAttributionMap } from '../hooks/useNetworkAttributionMap';
import { edgePath, layoutNetworkMap, shortenLabel } from '../utils/layoutNetworkMap';
import { getAppIconStyle, getDeviceIconStyle, getDomainIconStyle } from '../utils/appIcons';
import { NetworkMapEdge, PositionedNode } from '../types/networkMap';

const NODE_R = 11;
const ICON_SIZE = 13;

const flowPulse = keyframes`
  to {
    stroke-dashoffset: -18;
  }
`;

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
        : alpha(style.color, 0.85);

  const tooltip =
    node.type === 'app'
      ? `${node.label} (foreground process)`
      : node.type === 'domain'
        ? `${node.label}${node.blocked ? ' · blocked' : ''}`
        : `${node.label}${node.client_ip ? ` · ${node.client_ip}` : ''}`;

  return (
    <g transform={`translate(${node.x}, ${node.y})`} style={{ cursor: 'default' }}>
      <title>{tooltip}</title>
      <circle
        r={NODE_R + 3}
        fill={theme.palette.background.paper}
        stroke={ring}
        strokeWidth={node.type === 'device' && node.fresh ? 1.75 : 1.25}
      />
      <circle r={NODE_R} fill={style.bg} />
      <foreignObject
        x={-ICON_SIZE / 2}
        y={-ICON_SIZE / 2}
        width={ICON_SIZE}
        height={ICON_SIZE}
        style={{ pointerEvents: 'none' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: style.color,
            fontSize: ICON_SIZE,
            width: ICON_SIZE,
            height: ICON_SIZE,
            '& svg': { fontSize: ICON_SIZE },
          }}
        >
          {style.icon}
        </Box>
      </foreignObject>
    </g>
  );
}

function edgeTooltip(edge: NetworkMapEdge, nodes: Map<string, PositionedNode>): string {
  const source = nodes.get(edge.source)?.label ?? edge.source;
  const target = nodes.get(edge.target)?.label ?? edge.target;
  if (edge.kind === 'foreground') {
    return `${source} → ${target} (foreground app)`;
  }
  if (edge.kind === 'dns_direct') {
    const blocked = edge.blocked_count > 0 ? ` · ${edge.blocked_count} blocked` : '';
    return `${source} → ${target} · ${edge.query_count} DNS (no app yet)${blocked}`;
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

  const landFill = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.06);
  const laneStroke = alpha(theme.palette.divider, 0.55);

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
        {data && <Chip size="small" variant="outlined" label={`Last ${data.minutes} min`} />}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          position: 'relative',
          borderRadius: 1,
          overflow: 'hidden',
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: landFill,
          minHeight: 300,
          '& .network-flow-active': {
            strokeDasharray: '5 5',
            animation: `${flowPulse} 1.6s linear infinite`,
          },
        }}
      >
        {loading && !layout && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {layout && layout.nodes.length > 0 && (
          <Box
            component="svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMid meet"
            sx={{ width: '100%', height: 'auto', display: 'block', minHeight: 300 }}
            role="img"
            aria-label="Network map with devices, processes, and DNS destinations connected by arcs"
          >
            <line x1={COL_GUIDE.device} y1={28} x2={COL_GUIDE.device} y2={layout.height - 20} stroke={laneStroke} strokeDasharray="4 6" />
            <line x1={COL_GUIDE.app} y1={28} x2={COL_GUIDE.app} y2={layout.height - 20} stroke={laneStroke} strokeDasharray="4 6" />
            <line x1={COL_GUIDE.domain} y1={28} x2={COL_GUIDE.domain} y2={layout.height - 20} stroke={laneStroke} strokeDasharray="4 6" />

            <text x={COL_GUIDE.device} y={18} textAnchor="middle" fontSize={10} fontWeight={600} fill={theme.palette.text.secondary}>
              Devices
            </text>
            <text x={COL_GUIDE.app} y={18} textAnchor="middle" fontSize={10} fontWeight={600} fill={theme.palette.text.secondary}>
              Processes
            </text>
            <text x={COL_GUIDE.domain} y={18} textAnchor="middle" fontSize={10} fontWeight={600} fill={theme.palette.text.secondary}>
              Destinations
            </text>

            {layout.edges.map((edge) => {
              const from = nodeMap.get(edge.source);
              const to = nodeMap.get(edge.target);
              if (!from || !to) {
                return null;
              }
              const animated = edge.kind === 'dns' || edge.kind === 'dns_direct';
              const stroke =
                edge.kind === 'foreground'
                  ? theme.palette.info.main
                  : edge.kind === 'dns_direct'
                    ? theme.palette.text.disabled
                    : edge.blocked_count > 0
                      ? theme.palette.error.main
                      : theme.palette.success.main;
              return (
                <path
                  key={`${edge.source}-${edge.target}-${edge.kind}`}
                  d={edgePath(from.x, from.y, to.x, to.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={
                    edge.kind === 'foreground'
                      ? 1.25
                      : Math.min(3, 1 + Math.log2(edge.query_count + 1) * 0.6)
                  }
                  strokeDasharray={edge.kind === 'dns_direct' ? '5 4' : undefined}
                  opacity={edge.kind === 'foreground' ? 0.5 : edge.kind === 'dns_direct' ? 0.45 : 0.8}
                  strokeLinecap="round"
                  className={animated ? 'network-flow-active' : undefined}
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
            <Typography variant="body2" color="text.secondary">
              No network activity in the last {data?.minutes ?? minutes} minutes. Connect a client and browse
              to populate the map.
            </Typography>
          </Box>
        )}
      </Box>

      {layout && layout.nodes.length > 0 && (
        <>
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.5 }}>
            <Chip size="small" variant="outlined" label="Teal pin = device" />
            <Chip size="small" variant="outlined" label="Center = process" />
            <Chip size="small" variant="outlined" label="Right = DNS destination" />
            <Chip
              size="small"
              variant="outlined"
              label="Animated arc = live DNS"
              sx={{ borderColor: 'success.main', color: 'success.main' }}
            />
            <Chip
              size="small"
              variant="outlined"
              label="Dashed = no app yet"
              sx={{ borderColor: 'text.disabled', color: 'text.secondary' }}
            />
          </Stack>

          <Box
            sx={{
              mt: 1.5,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
              gap: 1,
            }}
          >
            {layout.nodes.slice(0, 12).map((node) => {
              const style =
                node.type === 'device'
                  ? getDeviceIconStyle()
                  : node.type === 'app'
                    ? getAppIconStyle(node.app_slug)
                    : getDomainIconStyle(node.blocked);
              return (
                <Stack
                  key={node.id}
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.background.paper, 0.6),
                    border: `1px solid ${theme.palette.divider}`,
                    minWidth: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      bgcolor: style.bg,
                      color: style.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      '& svg': { fontSize: 13 },
                    }}
                  >
                    {style.icon}
                  </Box>
                  <Typography variant="caption" noWrap title={node.label} sx={{ minWidth: 0 }}>
                    {shortenLabel(node.label)}
                  </Typography>
                </Stack>
              );
            })}
          </Box>
          {layout.nodes.length > 12 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              +{layout.nodes.length - 12} more — hover pins on the map for full names
            </Typography>
          )}
        </>
      )}
    </Paper>
  );
}

const COL_GUIDE = {
  device: 130,
  app: 380,
  domain: 640,
};
