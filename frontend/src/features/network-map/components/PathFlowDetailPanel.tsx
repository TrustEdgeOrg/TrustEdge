import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { alpha, useTheme } from '@mui/material/styles';
import { PathFlowDetail, PathFlowStepStatus } from '../utils/buildPathFlowDetail';

interface PathFlowDetailPanelProps {
  flows: PathFlowDetail[];
  onClose: () => void;
}

function stepColor(status: PathFlowStepStatus, theme: ReturnType<typeof useTheme>): string {
  switch (status) {
    case 'blocked':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'ok':
      return theme.palette.success.main;
    default:
      return theme.palette.text.secondary;
  }
}

function FlowSteps({ flow }: { flow: PathFlowDetail }) {
  const theme = useTheme();

  return (
    <Stack spacing={0.75}>
      {flow.steps.map((step, index) => (
        <Stack key={`${flow.flowKey}-${step.title}`} direction="row" spacing={1} alignItems="flex-start">
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              bgcolor: alpha(stepColor(step.status, theme), 0.12),
              color: stepColor(step.status, theme),
              border: `1px solid ${alpha(stepColor(step.status, theme), 0.35)}`,
            }}
          >
            {index + 1}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              {step.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {step.detail}
            </Typography>
          </Box>
          {index < flow.steps.length - 1 && (
            <ArrowDownwardIcon sx={{ fontSize: 14, color: 'text.disabled', ml: 0.5, mt: 0.25 }} />
          )}
        </Stack>
      ))}
    </Stack>
  );
}

export default function PathFlowDetailPanel({ flows, onClose }: PathFlowDetailPanelProps) {
  const theme = useTheme();
  if (flows.length === 0) {
    return null;
  }

  const primary = flows[0];

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mt: 1.5,
        borderColor: primary.blocked ? theme.palette.error.main : theme.palette.info.main,
        bgcolor: alpha(theme.palette.background.paper, 0.95),
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={600}>
            DNS path — {primary.domainLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Logical digital-twin path (not packet capture). Click a destination or path arc to inspect.
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Close path detail" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {flows.length === 1 ? (
        <FlowSteps flow={primary} />
      ) : (
        <Stack spacing={2}>
          {flows.map((flow) => (
            <Box
              key={flow.flowKey}
              sx={{
                p: 1.5,
                borderRadius: 1,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                {flow.deviceLabel}
                {flow.appLabel ? ` · ${flow.appLabel}` : ' · direct DNS'}
                {' · '}
                {flow.queryCount} quer{flow.queryCount === 1 ? 'y' : 'ies'}
              </Typography>
              <FlowSteps flow={flow} />
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
