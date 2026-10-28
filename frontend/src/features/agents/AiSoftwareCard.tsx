import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { AiSoftwareItem } from '../twin/types/aiSoftware';
import { aiAppIcon, aiAppIconColor, isCliAgent, isIdeExtension, isLocalModelRuntime } from './utils/aiAppIcons';
import {
  confidenceShortLabel,
  confidenceStrength,
  confidenceTone,
  explainConfidence,
} from './utils/aiConfidenceDisplay';

type Props = {
  items: AiSoftwareItem[];
  loading: boolean;
  error: string | null;
};

const CONFIDENCE_HELP =
  'How sure we are that this install is the real product — based on identity signals like path, package, signature, or Docker image.';

const CATEGORY_LABELS: Record<string, string> = {
  code_editor: 'Code editor',
  chat_client: 'Chat client',
  cli_agent: 'CLI agent',
  local_model_runtime: 'Local model runtime',
  ai_ide_extension: 'AI IDE extension',
  agentic_ide_extension: 'Agentic IDE extension',
};

const HOST_IDE_LABELS: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
};

const EXPOSURE_LABELS: Record<string, string> = {
  LOOPBACK_ONLY: 'Loopback only',
  LAN_EXPOSED: 'LAN exposed',
  ALL_INTERFACES: 'All interfaces',
  OTHER: 'Other',
};

function categoryLabel(category: string): string {
  if (!category) return '—';
  const key = category.trim().toLowerCase();
  return CATEGORY_LABELS[key] || category.replace(/_/g, ' ');
}

function StatusDot({
  active,
  activeLabel,
  idleLabel,
}: {
  active: boolean;
  activeLabel: string;
  idleLabel: string;
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        aria-hidden
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: active ? 'success.main' : 'action.disabled',
          flexShrink: 0,
        }}
      />
      <Typography
        variant="body2"
        sx={{
          fontSize: '0.8125rem',
          color: active ? 'text.primary' : 'text.secondary',
          fontWeight: active ? 600 : 400,
        }}
      >
        {active ? activeLabel : idleLabel}
      </Typography>
    </Stack>
  );
}

function ConfidenceCell({
  item,
  onMeterHoverChange,
}: {
  item: AiSoftwareItem;
  onMeterHoverChange?: (hovering: boolean) => void;
}) {
  if (!item.confidence) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }

  const expl = explainConfidence(item);
  const filled = confidenceStrength(expl.level);
  const tone = confidenceTone(expl.level);
  const label = confidenceShortLabel(expl.level);

  const evidenceTitle = (
    <Box sx={{ maxWidth: 320, py: 0.5 }}>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 700, color: 'common.white' }}>
        {label}
      </Typography>
      {expl.matched.length === 0 && expl.failed.length === 0 ? (
        <Typography variant="caption">No evidence details</Typography>
      ) : null}
      {expl.matched.length > 0 ? (
        <Stack spacing={0.35} sx={{ mb: expl.failed.length ? 0.75 : 0 }}>
          {expl.matched.map((ev) => (
            <Stack key={`m-${ev}`} direction="row" spacing={0.75} alignItems="flex-start">
              <Typography
                component="span"
                variant="caption"
                sx={{ color: 'success.light', fontWeight: 700, lineHeight: 1.4, minWidth: 12 }}
              >
                ✓
              </Typography>
              <Typography variant="caption" sx={{ lineHeight: 1.4, color: 'common.white' }}>
                {ev}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
      {expl.failed.length > 0 ? (
        <Stack spacing={0.35}>
          {expl.failed.map((ev) => (
            <Stack key={`f-${ev}`} direction="row" spacing={0.75} alignItems="flex-start">
              <Typography
                component="span"
                variant="caption"
                sx={{ color: 'error.light', fontWeight: 700, lineHeight: 1.4, minWidth: 12 }}
              >
                ✕
              </Typography>
              <Typography variant="caption" sx={{ lineHeight: 1.4, color: 'common.white' }}>
                {ev}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Box>
  );

  return (
    <Tooltip
      title={evidenceTitle}
      arrow
      placement="top"
      enterTouchDelay={0}
      onOpen={() => onMeterHoverChange?.(true)}
      onClose={() => onMeterHoverChange?.(false)}
    >
      <Stack
        direction="row"
        spacing={0.35}
        alignItems="flex-end"
        tabIndex={0}
        aria-label={`Confidence ${label}`}
        sx={{ cursor: 'help', width: 'fit-content', outline: 'none', height: 14 }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Box
            key={i}
            sx={{
              width: 5,
              height: 6 + i * 3,
              borderRadius: 0.5,
              bgcolor: i < filled ? tone : 'action.disabledBackground',
            }}
          />
        ))}
      </Stack>
    </Tooltip>
  );
}

function StatusCell({ item }: { item: AiSoftwareItem }) {
  const runtime = isLocalModelRuntime(item.product_id, item.category);
  const extension = isIdeExtension(item.product_id, item.category);
  const exposure = item.exposure ? EXPOSURE_LABELS[item.exposure] || item.exposure.replace(/_/g, ' ') : '';
  const exposureTone =
    item.exposure === 'LOOPBACK_ONLY'
      ? 'success.main'
      : item.exposure === 'ALL_INTERFACES'
        ? 'warning.main'
        : 'text.secondary';

  return (
    <Stack spacing={0.35} alignItems="flex-start">
      {!extension ? (
        <StatusDot active={item.running} activeLabel="Running" idleLabel="Not running" />
      ) : (
        <StatusDot active={item.installed} activeLabel="Installed" idleLabel="Not installed" />
      )}
      {extension && item.enabled != null ? (
        <StatusDot active={!!item.enabled} activeLabel="Enabled" idleLabel="Disabled" />
      ) : null}
      {extension && item.active != null ? (
        <StatusDot active={!!item.active} activeLabel="Active" idleLabel="Inactive" />
      ) : null}
      {extension && item.active == null ? (
        <Typography variant="caption" color="text.secondary" sx={{ pl: '15px' }}>
          Active unknown
        </Typography>
      ) : null}
      {runtime ? <StatusDot active={!!item.serving} activeLabel="Serving" idleLabel="Not serving" /> : null}
      {runtime && exposure ? (
        <Typography variant="caption" sx={{ color: exposureTone, pl: '15px' }}>
          {exposure}
        </Typography>
      ) : null}
    </Stack>
  );
}

function PathCell({ item }: { item: AiSoftwareItem }) {
  const cli = isCliAgent(item.product_id, item.category);
  const runtime = isLocalModelRuntime(item.product_id, item.category);
  const extension = isIdeExtension(item.product_id, item.category);
  const displayPath = ((cli || runtime) && item.invocation_path) || item.path || item.resolved_path || '—';
  const packageBits = [item.package_manager, item.package_identifier || item.extension_id]
    .filter(Boolean)
    .join(' · ');
  const listeners = (item.listeners || [])
    .map((l) => (l.port != null ? `${l.addr || '—'}:${l.port}` : ''))
    .filter(Boolean)
    .join(', ');
  const models =
    runtime && (item.models_available || item.model_format)
      ? [item.models_available ? `${item.models_available} models` : null, item.model_format || null]
          .filter(Boolean)
          .join(' · ')
      : '';
  const clients =
    runtime && item.local_clients && item.local_clients.length
      ? `${item.local_clients.length} local client${item.local_clients.length === 1 ? '' : 's'}`
      : '';
  const hostIde =
    extension && item.host_ide_product_id
      ? HOST_IDE_LABELS[item.host_ide_product_id] || item.host_ide_product_id
      : '';
  const extBits = [
    hostIde ? `host ${hostIde}` : null,
    item.profile ? `profile ${item.profile}` : null,
    item.mcp_configured ? 'MCP configured' : null,
    item.mcp_servers && item.mcp_servers.length
      ? `MCP servers: ${item.mcp_servers.join(', ')}`
      : null,
    item.local_model_product_id ? `local model ${item.local_model_product_id}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Stack spacing={0.25} sx={{ maxWidth: 320 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
      >
        {displayPath}
      </Typography>
      {packageBits ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {packageBits}
        </Typography>
      ) : null}
      {extBits ? (
        <Typography variant="caption" color="text.secondary">
          {extBits}
        </Typography>
      ) : null}
      {listeners ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          listen {listeners}
        </Typography>
      ) : null}
      {models ? (
        <Typography variant="caption" color="text.secondary">
          {models}
        </Typography>
      ) : null}
      {clients ? (
        <Typography variant="caption" color="text.secondary">
          {clients}
        </Typography>
      ) : null}
    </Stack>
  );
}

export default function AiSoftwareCard({ items, loading, error }: Props) {
  const [meterHovering, setMeterHovering] = useState(false);

  if (loading && items.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" variant="outlined">
        {error}
      </Alert>
    );
  }

  if (!items.length) {
    return (
      <Alert severity="info" variant="outlined">
        No AI apps, CLI agents, IDE extensions, or local model runtimes reported for this agent yet.
      </Alert>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="AI tools inventory">
        <TableHead>
          <TableRow>
            <TableCell>Product</TableCell>
            <TableCell>Vendor</TableCell>
            <TableCell>Version</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>
              <Stack direction="row" spacing={0.5} alignItems="center" component="span">
                <Box component="span">Confidence</Box>
                <Tooltip
                  title={CONFIDENCE_HELP}
                  arrow
                  placement="top"
                  enterTouchDelay={0}
                  disableHoverListener={meterHovering}
                >
                  <HelpOutlineIcon
                    fontSize="inherit"
                    aria-label="What is confidence?"
                    aria-hidden={meterHovering}
                    sx={{
                      fontSize: 14,
                      color: 'text.disabled',
                      cursor: 'help',
                      visibility: meterHovering ? 'hidden' : 'visible',
                    }}
                  />
                </Tooltip>
              </Stack>
            </TableCell>
            <TableCell>Path</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const cli = isCliAgent(item.product_id, item.category);
            const runtime = isLocalModelRuntime(item.product_id, item.category);
            const extension = isIdeExtension(item.product_id, item.category);
            const version = item.runtime_version || item.version || '—';
            return (
              <TableRow key={item.id} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{
                        display: 'inline-flex',
                        color: aiAppIconColor(item.product_id, item.category),
                        flexShrink: 0,
                        '& > svg': { fontSize: 18 },
                      }}
                      aria-hidden
                    >
                      {aiAppIcon(item.product_id, undefined, item.category)}
                    </Box>
                    <Stack spacing={0.25}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.product_name || item.product_id || item.id}
                      </Typography>
                      {(cli || runtime) && item.executable ? (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {item.executable}
                        </Typography>
                      ) : null}
                      {extension && (item.extension_id || item.package_identifier) ? (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {item.extension_id || item.package_identifier}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                </TableCell>
                <TableCell>{item.vendor || '—'}</TableCell>
                <TableCell>{version}</TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                    {categoryLabel(item.category)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <StatusCell item={item} />
                </TableCell>
                <TableCell>
                  <ConfidenceCell item={item} onMeterHoverChange={setMeterHovering} />
                </TableCell>
                <TableCell>
                  <PathCell item={item} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
