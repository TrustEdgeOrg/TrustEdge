import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { alpha, useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import type { McpGraphHost } from './utils/agentMcpGraph';
import { aiAppIcon, aiAppIconColor } from './utils/aiAppIcons';
import { mcpServerIcon, mcpServerIconColor, mcpToolIcon } from './utils/mcpGraphIcons';

type Props = {
  hosts: McpGraphHost[];
};

type Tool = McpGraphHost['servers'][number]['tools'][number];

function GraphEdge({ length = 40 }: { length?: number }) {
  const theme = useTheme();
  const stroke = alpha(theme.palette.text.primary, 0.14);
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', width: length, flexShrink: 0, alignSelf: 'center' }}
      aria-hidden
    >
      <svg width={length} height={8}>
        <line x1={0} y1={4} x2={length} y2={4} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    </Box>
  );
}

function VerticalSpine({ height }: { height: number }) {
  const theme = useTheme();
  const stroke = alpha(theme.palette.text.primary, 0.14);
  return (
    <Box sx={{ width: 40, flexShrink: 0, display: 'flex', justifyContent: 'center' }} aria-hidden>
      <svg width={40} height={height}>
        <line x1={20} y1={0} x2={20} y2={height} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    </Box>
  );
}

function BranchEdge() {
  const theme = useTheme();
  const stroke = alpha(theme.palette.text.primary, 0.14);
  return (
    <Box sx={{ width: 40, flexShrink: 0, display: 'flex', alignItems: 'center' }} aria-hidden>
      <svg width={40} height={20}>
        <path d="M 0 10 H 32" stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      </svg>
    </Box>
  );
}

function StatusDot({ active, label }: { active?: boolean; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box
        aria-hidden
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: active ? 'success.main' : 'action.disabled',
          flexShrink: 0,
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
    </Stack>
  );
}

function GraphNode({
  icon,
  iconColor,
  title,
  subtitle,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexShrink: 0, minWidth: 120 }}>
      <Box sx={{ color: iconColor, display: 'flex', opacity: 0.92 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, lineHeight: 1.3 }} noWrap>
          {title}
        </Typography>
        {subtitle ? <Box sx={{ mt: 0.25 }}>{subtitle}</Box> : null}
      </Box>
    </Stack>
  );
}

function HostNode({ host }: { host: McpGraphHost }) {
  const color = aiAppIconColor(host.productId, host.category);
  return (
    <GraphNode
      icon={aiAppIcon(host.productId, { fontSize: 'medium' }, host.category)}
      iconColor={color}
      title={host.label}
      subtitle={<StatusDot active={host.running} label={host.running ? 'Running' : 'Installed'} />}
    />
  );
}

function ServerNode({ name, configured, observed }: { name: string; configured: boolean; observed: boolean }) {
  const color = mcpServerIconColor(name);
  const statusLabel = observed ? 'Used' : configured ? 'Configured' : 'Observed';
  return (
    <GraphNode
      icon={mcpServerIcon(name, { fontSize: 'medium' })}
      iconColor={color}
      title={name}
      subtitle={<StatusDot active={observed || configured} label={statusLabel} />}
    />
  );
}

function toolStatusLabel(tool: Tool): string | null {
  if (tool.live) return 'live';
  if (tool.observed) return 'used';
  if (tool.catalog) return 'catalog';
  return null;
}

function ToolsDialog({
  open,
  serverName,
  tools,
  onClose,
}: {
  open: boolean;
  serverName: string;
  tools: Tool[];
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ color: mcpServerIconColor(serverName), display: 'flex' }}>
            {mcpServerIcon(serverName)}
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              {serverName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {tools.length} MCP tool{tools.length === 1 ? '' : 's'}
            </Typography>
          </Box>
        </Stack>
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List dense disablePadding>
          {tools.map((tool) => {
            const status = toolStatusLabel(tool);
            return (
              <ListItem key={tool.name} divider sx={{ py: 0.75, px: 2.5, gap: 1 }}>
                <ListItemIcon sx={{ minWidth: 28, color: 'text.disabled' }}>
                  {mcpToolIcon(tool.name)}
                </ListItemIcon>
                <ListItemText
                  primary={tool.name}
                  primaryTypographyProps={{
                    variant: 'body2',
                    sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
                  }}
                />
                {status ? (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem', flexShrink: 0 }}>
                    {status}
                  </Typography>
                ) : null}
              </ListItem>
            );
          })}
        </List>
      </DialogContent>
    </Dialog>
  );
}

function ToolsNode({ serverName, tools }: { serverName: string; tools: Tool[] }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();

  if (!tools.length) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ py: 0.5 }}>
        No tools
      </Typography>
    );
  }

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          py: 0.5,
          px: 0,
          border: 0,
          bgcolor: 'transparent',
          cursor: 'pointer',
          color: 'text.secondary',
          font: 'inherit',
          borderRadius: 1,
          '&:hover': {
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.06),
          },
        }}
      >
        <BuildOutlinedIcon sx={{ fontSize: 18, opacity: 0.7 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Tools ({tools.length})
        </Typography>
      </Box>
      <ToolsDialog
        open={open}
        serverName={serverName}
        tools={tools}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function ServerRow({
  server,
  showHost,
  host,
  showBranch,
}: {
  server: McpGraphHost['servers'][number];
  showHost: boolean;
  host: McpGraphHost;
  showBranch: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: { xs: 'wrap', lg: 'nowrap' },
        gap: { xs: 1, lg: 0 },
        py: 0.5,
      }}
    >
      {showHost ? (
        <>
          <HostNode host={host} />
          <GraphEdge />
        </>
      ) : showBranch ? (
        <BranchEdge />
      ) : (
        <Box sx={{ width: { xs: 0, lg: 168 }, display: { xs: 'none', lg: 'block' }, flexShrink: 0 }} />
      )}
      <ServerNode name={server.name} configured={server.configured} observed={server.observed} />
      <GraphEdge />
      <ToolsNode serverName={server.name} tools={server.tools} />
    </Box>
  );
}

function HostGraph({ host }: { host: McpGraphHost }) {
  const multi = host.servers.length > 1;

  if (!multi) {
    const server = host.servers[0];
    return <ServerRow server={server} showHost showBranch={false} host={host} />;
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
        <HostNode host={host} />
      </Box>
      <VerticalSpine height={Math.max(72, host.servers.length * 72 - 16)} />
      <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
        {host.servers.map((server) => (
          <ServerRow key={server.name} server={server} showHost={false} showBranch host={host} />
        ))}
      </Stack>
    </Box>
  );
}

export default function AgentMcpGraphView({ hosts }: Props) {
  if (!hosts.length) {
    return (
      <Alert severity="info" variant="outlined">
        No MCP topology yet. Configure MCP in Cursor or VS Code (`mcp.json`) and wait for the agent
        inventory poll (~60s).
      </Alert>
    );
  }

  return (
    <Stack spacing={2.5}>
      {hosts.map((host) => (
        <Box key={host.id}>
          <HostGraph host={host} />
        </Box>
      ))}
      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
        Live = MCP tools/list · Configured = mcp.json · Used = governed telemetry · Catalog = fallback
      </Typography>
    </Stack>
  );
}
