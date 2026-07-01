import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import HubIcon from '@mui/icons-material/Hub';
import ScienceIcon from '@mui/icons-material/Science';
import BlockIcon from '@mui/icons-material/Block';
import RouteIcon from '@mui/icons-material/Route';
import { useNetworkAttributionMap } from '../hooks/useNetworkAttributionMap';
import { DEFAULT_NETWORK_MAP_MINUTES } from '../config/api';
import {
  edgePath,
  layoutNetworkMap,
  pathColumnLabels,
  shortenLabel,
} from '../utils/layoutNetworkMap';
import { getNodeIconStyle } from '../utils/appIcons';
import { NetworkMapEdge, NetworkMapNode, PositionedNode } from '../types/networkMap';
import {
  computeWhatIfSimulation,
  edgeKey,
  toggleDisabledApp,
  WhatIfSimulationResult,
} from '../utils/whatIfSimulation';
import { expandToPathView } from '../utils/expandPathView';
import {
  buildPathFlowDetailsForDomain,
  PathFlowDetail,
} from '../utils/buildPathFlowDetail';
import PathFlowDetailPanel from './PathFlowDetailPanel';

const NODE_R = 11;
const ICON_SIZE = 13;

const flowPulse = keyframes`
  to {
    stroke-dashoffset: -18;
  }
`;

interface MapNodeGlyphProps {
  node: PositionedNode;
  whatIfMode: boolean;
  pathViewMode: boolean;
  appDisabled: boolean;
  simulatedBlocked: boolean;
  selected: boolean;
  onSelectApp?: (nodeId: string) => void;
  onSelectDomain?: (nodeId: string) => void;
}

function MapNodeGlyph({
  node,
  whatIfMode,
  pathViewMode,
  appDisabled,
  simulatedBlocked,
  selected,
  onSelectApp,
  onSelectDomain,
}: MapNodeGlyphProps) {
  const theme = useTheme();
  const style = getNodeIconStyle({
    type: node.type,
    app_slug: node.app_slug,
    blocked: node.blocked || simulatedBlocked,
  });

  const isInfra = node.type === 'tunnel' || node.type === 'gateway' || node.type === 'policy';

  const ring = appDisabled
    ? theme.palette.error.main
    : selected
      ? theme.palette.info.main
      : node.type === 'device' && node.fresh
        ? theme.palette.success.main
        : node.type === 'domain' && (node.blocked || simulatedBlocked)
          ? theme.palette.error.main
          : isInfra
            ? style.color
            : alpha(style.color, 0.85);

  const tooltipParts = [
    node.type === 'app'
      ? `${node.label} (foreground process)`
      : node.type === 'domain'
        ? `${node.label}${node.blocked ? ' · blocked' : ''}${simulatedBlocked ? ' · would lose access (what-if)' : ''}`
        : node.type === 'tunnel'
          ? `${node.label} · VPN tunnel to gateway`
          : node.type === 'gateway'
            ? `${node.label} · dnsmasq on EC2`
            : node.type === 'policy'
              ? `${node.label} · allow / block decision`
              : `${node.label}${node.client_ip ? ` · ${node.client_ip}` : ''}`,
  ];
  if (whatIfMode && node.type === 'app') {
    tooltipParts.push(appDisabled ? 'Click to re-enable in what-if' : 'Click to disable in what-if');
  }
  if (pathViewMode && node.type === 'domain') {
    tooltipParts.push('Click to inspect DNS path');
  }

  const selectableApp = whatIfMode && node.type === 'app';
  const selectableDomain = pathViewMode && node.type === 'domain';

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{
        cursor: selectableApp || selectableDomain ? 'pointer' : 'default',
        opacity: appDisabled ? 0.45 : 1,
      }}
      onClick={
        selectableApp
          ? () => onSelectApp?.(node.id)
          : selectableDomain
            ? () => onSelectDomain?.(node.id)
            : undefined
      }
    >
      <title>{tooltipParts.join(' · ')}</title>
      <circle
        r={NODE_R + 3}
        fill={theme.palette.background.paper}
        stroke={ring}
        strokeWidth={
          selected ? 2.25 : appDisabled ? 2 : node.type === 'device' && node.fresh ? 1.75 : 1.25
        }
        strokeDasharray={appDisabled ? '3 2' : undefined}
      />
      <circle r={NODE_R} fill={style.bg} />
      {appDisabled && (
        <line
          x1={-NODE_R}
          y1={-NODE_R}
          x2={NODE_R}
          y2={NODE_R}
          stroke={theme.palette.error.main}
          strokeWidth={2}
        />
      )}
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
      {isInfra && (
        <text y={NODE_R + 14} textAnchor="middle" fontSize={8} fontWeight={600} fill={theme.palette.text.secondary}>
          {shortenLabel(node.label, 12)}
        </text>
      )}
    </g>
  );
}

function edgeTooltip(
  edge: NetworkMapEdge,
  nodes: Map<string, PositionedNode>,
  simulatedCut: boolean,
): string {
  const source = nodes.get(edge.source)?.label ?? edge.source;
  const target = nodes.get(edge.target)?.label ?? edge.target;
  if (simulatedCut) {
    return `${source} → ${target} · cut by what-if`;
  }
  if (edge.kind === 'foreground') {
    return `${source} → ${target} (foreground app)`;
  }
  if (edge.kind === 'path_egress') {
    return `${source} → ${target} · DNS leaves endpoint via VPN (${edge.query_count} quer${edge.query_count === 1 ? 'y' : 'ies'})`;
  }
  if (edge.kind === 'path_tunnel') {
    return `${source} → ${target} · encrypted tunnel transit`;
  }
  if (edge.kind === 'path_resolve') {
    return `${source} → ${target} · query received by dnsmasq`;
  }
  if (edge.kind === 'path_forward') {
    const blocked = edge.blocked_count > 0 ? ` · ${edge.blocked_count} blocked` : '';
    return `${source} → ${target} · policy decision · ${edge.query_count} quer${edge.query_count === 1 ? 'y' : 'ies'}${blocked} · click for path detail`;
  }
  if (edge.kind === 'dns_direct') {
    const blocked = edge.blocked_count > 0 ? ` · ${edge.blocked_count} blocked` : '';
    return `${source} → ${target} · ${edge.query_count} DNS (no app yet)${blocked}`;
  }
  const blocked = edge.blocked_count > 0 ? ` · ${edge.blocked_count} blocked` : '';
  return `${source} → ${target} · ${edge.query_count} DNS quer${edge.query_count === 1 ? 'y' : 'ies'}${blocked}`;
}

function isEdgeSimulatedCut(
  edge: NetworkMapEdge,
  whatIf: WhatIfSimulationResult | null,
  pathViewMode: boolean,
): boolean {
  if (!whatIf) {
    return false;
  }
  if (pathViewMode) {
    if (edge.kind === 'path_egress') {
      return whatIf.disabledAppIds.has(edge.source);
    }
    if (edge.kind === 'path_forward') {
      return whatIf.simulatedBlockedDomainIds.has(edge.target);
    }
    return false;
  }
  return whatIf.disabledEdgeKeys.has(edgeKey(edge));
}

function edgeStroke(
  edge: NetworkMapEdge,
  theme: ReturnType<typeof useTheme>,
  simulatedCut: boolean,
): string {
  if (simulatedCut) {
    return theme.palette.error.main;
  }
  if (edge.kind === 'foreground') {
    return theme.palette.info.main;
  }
  if (edge.kind === 'path_tunnel' || edge.kind === 'path_resolve') {
    return theme.palette.secondary.main;
  }
  if (edge.kind === 'path_egress') {
    return theme.palette.primary.main;
  }
  if (edge.kind === 'path_forward') {
    return edge.blocked_count > 0 ? theme.palette.error.main : theme.palette.success.main;
  }
  if (edge.kind === 'dns_direct') {
    return theme.palette.text.disabled;
  }
  return edge.blocked_count > 0 ? theme.palette.error.main : theme.palette.success.main;
}

interface NetworkAttributionMapGraphProps {
  minutes?: number;
  showHeader?: boolean;
}

export default function NetworkAttributionMapGraph({
  minutes = DEFAULT_NETWORK_MAP_MINUTES,
  showHeader = true,
}: NetworkAttributionMapGraphProps) {
  const theme = useTheme();
  const { data, loading, error, liveConnected } = useNetworkAttributionMap(minutes);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [pathViewMode, setPathViewMode] = useState(false);
  const [disabledAppIds, setDisabledAppIds] = useState<Set<string>>(new Set());
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  const graphData = useMemo(() => {
    if (!data) {
      return null;
    }
    if (!pathViewMode) {
      return { nodes: data.nodes, edges: data.edges };
    }
    return expandToPathView(data.nodes, data.edges);
  }, [data, pathViewMode]);

  const layout = useMemo(() => {
    if (!graphData) {
      return null;
    }
    return layoutNetworkMap(graphData.nodes, graphData.edges, pathViewMode ? 'path' : 'attribution');
  }, [graphData, pathViewMode]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    layout?.nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [layout]);

  const whatIf = useMemo(() => {
    if (!data || !whatIfMode) {
      return null;
    }
    return computeWhatIfSimulation(data.nodes, data.edges, disabledAppIds);
  }, [data, whatIfMode, disabledAppIds]);

  const selectedFlows = useMemo((): PathFlowDetail[] => {
    if (!data || !selectedDomainId) {
      return [];
    }
    return buildPathFlowDetailsForDomain(selectedDomainId, data.nodes, data.edges);
  }, [data, selectedDomainId]);

  const appNodes = useMemo(
    () => (data?.nodes.filter((n) => n.type === 'app') ?? []) as NetworkMapNode[],
    [data],
  );

  const disabledAppLabels = useMemo(() => {
    if (!data || disabledAppIds.size === 0) {
      return [];
    }
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]));
    return [...disabledAppIds].map((id) => byId.get(id) ?? id);
  }, [data, disabledAppIds]);

  const handleToggleApp = (appNodeId: string) => {
    setDisabledAppIds((prev) => toggleDisabledApp(prev, appNodeId));
  };

  const handleWhatIfModeChange = (enabled: boolean) => {
    setWhatIfMode(enabled);
    if (!enabled) {
      setDisabledAppIds(new Set());
    }
  };

  const handlePathViewChange = (enabled: boolean) => {
    setPathViewMode(enabled);
    if (!enabled) {
      setSelectedDomainId(null);
    }
  };

  const handleEdgeClick = (edge: NetworkMapEdge) => {
    if (!pathViewMode || !data) {
      return;
    }
    if (edge.kind === 'path_forward') {
      setSelectedDomainId(edge.target);
      return;
    }
    if (edge.kind === 'dns' || edge.kind === 'dns_direct') {
      setSelectedDomainId(edge.target);
    }
  };

  const handleDomainSelect = (domainId: string) => {
    setSelectedDomainId((prev) => (prev === domainId ? null : domainId));
  };

  const deviceCount = data?.nodes.filter((n) => n.type === 'device').length ?? 0;
  const appCount = data?.nodes.filter((n) => n.type === 'app').length ?? 0;
  const domainCount = data?.nodes.filter((n) => n.type === 'domain').length ?? 0;

  const landFill = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.06);
  const laneStroke = alpha(theme.palette.divider, 0.55);
  const columnLabels = pathColumnLabels(pathViewMode ? 'path' : 'attribution');

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

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          <Chip size="small" variant="outlined" label={`${deviceCount} devices`} />
          <Chip size="small" variant="outlined" label={`${appCount} apps`} />
          <Chip size="small" variant="outlined" label={`${domainCount} destinations`} />
          {data && <Chip size="small" variant="outlined" label={`Last ${data.minutes} min`} />}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={pathViewMode}
                onChange={(_, checked) => handlePathViewChange(checked)}
              />
            }
            label={
              <Stack direction="row" spacing={0.5} alignItems="center">
                <RouteIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2">Path view</Typography>
              </Stack>
            }
            sx={{ m: 0 }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={whatIfMode}
                onChange={(_, checked) => handleWhatIfModeChange(checked)}
              />
            }
            label={
              <Stack direction="row" spacing={0.5} alignItems="center">
                <ScienceIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2">What-if</Typography>
              </Stack>
            }
            sx={{ m: 0 }}
          />
        </Stack>
      </Stack>

      {pathViewMode && (
        <Alert severity="info" sx={{ mb: 1.5 }} icon={<RouteIcon fontSize="small" />}>
          Path view shows the logical DNS journey: endpoint → WireGuard → TrustEdge DNS → policy → destination.
          Click a destination or green/red path arc for step-by-step detail.
        </Alert>
      )}

      {whatIfMode && (
        <Alert severity="info" sx={{ mb: 1.5 }} icon={<ScienceIcon fontSize="small" />}>
          {disabledAppIds.size === 0 ? (
            <>Select a process below or on the map to simulate it being disabled.</>
          ) : (
            <>
              Simulating disabled: <strong>{disabledAppLabels.join(', ')}</strong>
              {' · '}
              {whatIf?.affectedQueryCount ?? 0} DNS quer{(whatIf?.affectedQueryCount ?? 0) === 1 ? 'y' : 'ies'} cut
              {' · '}
              {whatIf?.affectedDomainCount ?? 0} destination{(whatIf?.affectedDomainCount ?? 0) === 1 ? '' : 's'} would lose access
            </>
          )}
          {disabledAppIds.size > 0 && (
            <Button size="small" sx={{ ml: 1, mt: { xs: 1, sm: 0 } }} onClick={() => setDisabledAppIds(new Set())}>
              Clear
            </Button>
          )}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {whatIfMode && appNodes.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
          {appNodes.map((app) => {
            const selected = disabledAppIds.has(app.id);
            const icon = getNodeIconStyle({ type: 'app', app_slug: app.app_slug });
            return (
              <Chip
                key={app.id}
                size="small"
                variant={selected ? 'filled' : 'outlined'}
                color={selected ? 'error' : 'default'}
                icon={
                  selected ? (
                    <BlockIcon sx={{ fontSize: 14 }} />
                  ) : (
                    <Box component="span" sx={{ display: 'flex', color: icon.color, ml: 0.5 }}>
                      {icon.icon}
                    </Box>
                  )
                }
                label={`${selected ? 'Disable ' : ''}${app.label}`}
                onClick={() => handleToggleApp(app.id)}
                sx={{ cursor: 'pointer' }}
              />
            );
          })}
        </Stack>
      )}

      <Box
        sx={{
          position: 'relative',
          borderRadius: 1,
          overflow: 'auto',
          border: `1px solid ${
            whatIfMode ? theme.palette.info.main : pathViewMode ? theme.palette.secondary.main : theme.palette.divider
          }`,
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
            sx={{ width: '100%', minWidth: pathViewMode ? 640 : undefined, height: 'auto', display: 'block', minHeight: 300 }}
            role="img"
            aria-label={
              pathViewMode
                ? 'Network map with DNS path through WireGuard, gateway, and policy'
                : 'Network map with devices, processes, and DNS destinations connected by arcs'
            }
          >
            {columnLabels.map(({ key, label }) => {
              const x = layout.columnGuides[key];
              if (x == null) {
                return null;
              }
              return (
                <g key={key}>
                  <line
                    x1={x}
                    y1={28}
                    x2={x}
                    y2={layout.height - 20}
                    stroke={laneStroke}
                    strokeDasharray="4 6"
                  />
                  <text x={x} y={18} textAnchor="middle" fontSize={9} fontWeight={600} fill={theme.palette.text.secondary}>
                    {label}
                  </text>
                </g>
              );
            })}

            {layout.edges.map((edge) => {
              const from = nodeMap.get(edge.source);
              const to = nodeMap.get(edge.target);
              if (!from || !to) {
                return null;
              }
              const simulatedCut = isEdgeSimulatedCut(edge, whatIf, pathViewMode);
              const animated =
                !simulatedCut &&
                (edge.kind === 'dns' ||
                  edge.kind === 'dns_direct' ||
                  edge.kind === 'path_forward' ||
                  edge.kind === 'path_egress');
              const stroke = edgeStroke(edge, theme, simulatedCut);
              const clickable =
                pathViewMode && (edge.kind === 'path_forward' || edge.kind === 'dns' || edge.kind === 'dns_direct');
              return (
                <path
                  key={`${edge.source}-${edge.target}-${edge.kind}`}
                  d={edgePath(from.x, from.y, to.x, to.y)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={
                    edge.kind === 'foreground' || edge.kind === 'path_tunnel' || edge.kind === 'path_resolve'
                      ? 1.25
                      : Math.min(3, 1 + Math.log2(edge.query_count + 1) * 0.6)
                  }
                  strokeDasharray={
                    simulatedCut || edge.kind === 'dns_direct' || edge.kind === 'path_tunnel'
                      ? '5 4'
                      : undefined
                  }
                  opacity={
                    simulatedCut
                      ? 0.55
                      : edge.kind === 'foreground'
                        ? 0.5
                        : edge.kind === 'dns_direct'
                          ? 0.45
                          : edge.kind === 'path_tunnel' || edge.kind === 'path_resolve'
                            ? 0.65
                            : 0.8
                  }
                  strokeLinecap="round"
                  className={animated ? 'network-flow-active' : undefined}
                  style={{ cursor: clickable ? 'pointer' : undefined }}
                  onClick={clickable ? () => handleEdgeClick(edge) : undefined}
                >
                  <title>{edgeTooltip(edge, nodeMap, simulatedCut)}</title>
                </path>
              );
            })}

            {layout.nodes.map((node) => (
              <MapNodeGlyph
                key={node.id}
                node={node}
                whatIfMode={whatIfMode}
                pathViewMode={pathViewMode}
                appDisabled={whatIfMode && disabledAppIds.has(node.id)}
                simulatedBlocked={whatIf?.simulatedBlockedDomainIds.has(node.id) ?? false}
                selected={selectedDomainId === node.id}
                onSelectApp={handleToggleApp}
                onSelectDomain={handleDomainSelect}
              />
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

      {selectedFlows.length > 0 && (
        <PathFlowDetailPanel flows={selectedFlows} onClose={() => setSelectedDomainId(null)} />
      )}

      {layout && layout.nodes.length > 0 && (
        <>
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.5 }}>
            <Chip size="small" variant="outlined" label="Teal pin = device" />
            <Chip size="small" variant="outlined" label="Center = process" />
            {pathViewMode ? (
              <>
                <Chip size="small" variant="outlined" label="Purple = WireGuard" />
                <Chip size="small" variant="outlined" label="Blue = TrustEdge DNS" />
                <Chip size="small" variant="outlined" label="Amber = policy gate" />
              </>
            ) : (
              <Chip size="small" variant="outlined" label="Right = DNS destination" />
            )}
            <Chip
              size="small"
              variant="outlined"
              label="Animated arc = live DNS"
              sx={{ borderColor: 'success.main', color: 'success.main' }}
            />
            {!pathViewMode && (
              <Chip
                size="small"
                variant="outlined"
                label="Dashed = no app yet"
                sx={{ borderColor: 'text.disabled', color: 'text.secondary' }}
              />
            )}
            {whatIfMode && (
              <Chip
                size="small"
                variant="outlined"
                label="Red cut = what-if disabled"
                sx={{ borderColor: 'error.main', color: 'error.main' }}
              />
            )}
          </Stack>

          <Box
            sx={{
              mt: 1.5,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
              gap: 1,
            }}
          >
            {layout.nodes
              .filter((node) => node.type !== 'tunnel' && node.type !== 'gateway' && node.type !== 'policy')
              .slice(0, 12)
              .map((node) => {
                const style = getNodeIconStyle({
                  type: node.type,
                  app_slug: node.app_slug,
                  blocked: node.blocked || (whatIf?.simulatedBlockedDomainIds.has(node.id) ?? false),
                });
                const appDisabled = whatIfMode && disabledAppIds.has(node.id);
                const domainSelected = pathViewMode && selectedDomainId === node.id;
                return (
                  <Stack
                    key={node.id}
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    onClick={
                      whatIfMode && node.type === 'app'
                        ? () => handleToggleApp(node.id)
                        : pathViewMode && node.type === 'domain'
                          ? () => handleDomainSelect(node.id)
                          : undefined
                    }
                    sx={{
                      px: 1,
                      py: 0.5,
                      borderRadius: 1,
                      bgcolor: alpha(theme.palette.background.paper, 0.6),
                      border: `1px solid ${
                        appDisabled
                          ? theme.palette.error.main
                          : domainSelected
                            ? theme.palette.info.main
                            : theme.palette.divider
                      }`,
                      minWidth: 0,
                      opacity: appDisabled ? 0.55 : 1,
                      cursor:
                        (whatIfMode && node.type === 'app') || (pathViewMode && node.type === 'domain')
                          ? 'pointer'
                          : 'default',
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
