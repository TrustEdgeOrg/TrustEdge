import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import { alpha, useTheme } from '@mui/material/styles';
import StreamIcon from '@mui/icons-material/Stream';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import FingerprintOutlinedIcon from '@mui/icons-material/FingerprintOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import type { ReactElement } from 'react';
import './AgentFlow.css';

type FlowStep = {
  id: string;
  title: string;
  plain: string;
  detail: string;
  icon: ReactElement;
  tone: 'edge' | 'path' | 'cloud' | 'detect';
};

const STEPS: FlowStep[] = [
  {
    id: 'arrive',
    title: 'Kafka stream',
    plain: 'Telemetry lands on a durable topic after Agent API accepts a batch.',
    detail:
      'The detection engine consumes trustedge.agent.events. Each message is one agent event — process, network, security lifecycle, AI tools inventory, and more.',
    icon: <StreamIcon fontSize="small" />,
    tone: 'cloud',
  },
  {
    id: 'remember',
    title: 'Device context',
    plain: 'A short rolling history per device lets engines compare “now” to recent activity.',
    detail:
      'StateStore keeps recent events and process graph context per device_id — enough for parent shells, prior IPs, and session reconstruction.',
    icon: <StorageOutlinedIcon fontSize="small" />,
    tone: 'cloud',
  },
  {
    id: 'lane',
    title: 'Route by signal',
    plain: 'Only engines and rules that apply to this event type run.',
    detail:
      'process_start → process / chain rules and AI activity. network_summary → network rules. driver / service / persistence → security rules. known_ai_app → AI inventory context. ai_agent_action → MCP / agent-action governance.',
    icon: <FilterAltOutlinedIcon fontSize="small" />,
    tone: 'path',
  },
  {
    id: 'evaluate',
    title: 'Multi-engine detect',
    plain: 'YAML attack/chain rules, behavior baselines, and AI activity analysis — deterministic, fused into one finding.',
    detail:
      'Rules catch chains and drift. Behavior flags novel processes against a per-device baseline. AI activity reconstructs agentic sessions and tool risk. Optional threat-intel enrichers may add hits. LLMs do not judge.',
    icon: <RuleOutlinedIcon fontSize="small" />,
    tone: 'detect',
  },
  {
    id: 'evidence',
    title: 'Attach evidence',
    plain: 'Findings carry enough context for an operator to investigate quickly.',
    detail:
      'Process alerts add ancestry and related activity. Network alerts include from/to posture. AI findings include session and tool context. The UI uses this for graphs and explain.',
    icon: <AccountTreeOutlinedIcon fontSize="small" />,
    tone: 'detect',
  },
  {
    id: 'dedupe',
    title: 'Deduplicate',
    plain: 'The same finding should not flood the console.',
    detail:
      'Fingerprints skip recently seen alerts. Windowed rules use cooldowns so repeat noise stays controlled.',
    icon: <FingerprintOutlinedIcon fontSize="small" />,
    tone: 'path',
  },
  {
    id: 'ingest',
    title: 'Alert ingest',
    plain: 'Scored alerts are posted to the control plane for enrich and persist.',
    detail:
      'POST /security/alerts/ingest writes durable alert records operators can filter by device, severity, and type.',
    icon: <CloudUploadOutlinedIcon fontSize="small" />,
    tone: 'detect',
  },
  {
    id: 'surface',
    title: 'Operate',
    plain: 'Attack alerts appear in Alerts and on agent detail — ready for review.',
    detail:
      'Optional Ollama / OpenAI / template explain narrates what engines already fired — it never decides what is malicious.',
    icon: <DashboardOutlinedIcon fontSize="small" />,
    tone: 'detect',
  },
];

const COVERS = [
  'Attack / chain rules (shell → downloader, temp-path exec, persistence)',
  'Network drift (IP / type change, flapping, connection spikes)',
  'Behavior baselines and novel-process alerts',
  'AI activity sessions and AI-tool findings',
];

const NOT_THIS = [
  'Not antivirus signatures or a malware sandbox',
  'Not an LLM deciding “good” vs “bad”',
  'Not a replacement for long-term SIEM history',
  'Not opaque scoring — engines are deterministic and evidence-backed',
];

function toneColor(
  tone: FlowStep['tone'],
  theme: ReturnType<typeof useTheme>,
): { bg: string; fg: string; ring: string } {
  const isDark = theme.palette.mode === 'dark';
  switch (tone) {
    case 'edge':
      return {
        bg: alpha(theme.palette.info.main, isDark ? 0.18 : 0.12),
        fg: isDark ? theme.palette.info.light : theme.palette.info.dark,
        ring: alpha(theme.palette.info.main, 0.45),
      };
    case 'path':
      return {
        bg: alpha(theme.palette.primary.main, isDark ? 0.18 : 0.1),
        fg: isDark ? theme.palette.primary.light : theme.palette.primary.dark,
        ring: alpha(theme.palette.primary.main, 0.45),
      };
    case 'cloud':
      return {
        bg: alpha(theme.palette.secondary.main, isDark ? 0.2 : 0.12),
        fg: isDark ? theme.palette.secondary.light : theme.palette.secondary.dark,
        ring: alpha(theme.palette.secondary.main, 0.45),
      };
    case 'detect':
    default:
      return {
        bg: alpha(theme.palette.warning.main, isDark ? 0.18 : 0.14),
        fg: isDark ? theme.palette.warning.light : theme.palette.warning.dark,
        ring: alpha(theme.palette.warning.main, 0.5),
      };
  }
}

export default function DetectionFlow() {
  const theme = useTheme();
  const [activeId, setActiveId] = useState(STEPS[0].id);
  const active = useMemo(
    () => STEPS.find((s) => s.id === activeId) || STEPS[0],
    [activeId],
  );
  const activeTone = toneColor(active.tone, theme);

  return (
    <Box className="agent-flow" sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
      <Paper
        variant="outlined"
        className="agent-flow-hero"
        sx={{
          p: { xs: 2.5, md: 3.5 },
          mb: 3,
          overflow: 'hidden',
          position: 'relative',
          background: (t) =>
            `linear-gradient(135deg, ${alpha(t.palette.warning.main, t.palette.mode === 'dark' ? 0.14 : 0.1)} 0%, ${alpha(
              t.palette.background.paper,
              0.4,
            )} 55%, ${alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.12 : 0.06)} 100%)`,
        }}
      >
        <Stack spacing={1.5} sx={{ position: 'relative', zIndex: 1, maxWidth: 720 }}>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Detection engine
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
            Kafka feeds attack/chain rules, the behavioral engine, and AI activity analysis. Findings are
            fused, ingested into the control plane, and shown as attack alerts. Rules decide — LLMs only
            explain. Select a step for detail.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ pt: 0.5 }}>
            <Button
              component={RouterLink}
              to="/alerts"
              variant="contained"
              size="small"
              endIcon={<ArrowForwardIcon />}
            >
              View alerts
            </Button>
            <Button component={RouterLink} to="/how-it-works" variant="outlined" size="small">
              How it works
            </Button>
          </Stack>
        </Stack>
        <Box className="agent-flow-hero-orb agent-flow-hero-orb--a" aria-hidden />
        <Box className="agent-flow-hero-orb agent-flow-hero-orb--b" aria-hidden />
      </Paper>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
        Detection path — Stream · Engines · Ingest · Operate
      </Typography>

      <Box className="agent-flow-rail" sx={{ mb: 2.5 }}>
        {STEPS.map((step, index) => {
          const colors = toneColor(step.tone, theme);
          const selected = step.id === activeId;
          return (
            <Box key={step.id} className="agent-flow-rail-item">
              {index > 0 && (
                <Box
                  className="agent-flow-connector"
                  sx={{
                    background: (t) =>
                      `linear-gradient(90deg, ${alpha(t.palette.warning.main, 0.2)}, ${alpha(
                        t.palette.primary.main,
                        0.55,
                      )})`,
                  }}
                  aria-hidden
                />
              )}
              <button
                type="button"
                className={`agent-flow-step ${selected ? 'is-active' : ''}`}
                onClick={() => setActiveId(step.id)}
                aria-pressed={selected}
              >
                <Box
                  className="agent-flow-step-icon"
                  sx={{
                    bgcolor: colors.bg,
                    color: colors.fg,
                    boxShadow: selected ? `0 0 0 3px ${colors.ring}` : 'none',
                  }}
                >
                  {step.icon}
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: selected ? 700 : 500,
                    color: selected ? 'text.primary' : 'text.secondary',
                    textAlign: 'center',
                    lineHeight: 1.25,
                  }}
                >
                  {index + 1}. {step.title}
                </Typography>
              </button>
            </Box>
          );
        })}
      </Box>

      <Paper
        variant="outlined"
        className="agent-flow-detail"
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
          borderColor: activeTone.ring,
          background: (t) =>
            `linear-gradient(180deg, ${alpha(activeTone.fg, t.palette.mode === 'dark' ? 0.08 : 0.04)} 0%, ${t.palette.background.paper} 48%)`,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: activeTone.bg,
              color: activeTone.fg,
              flexShrink: 0,
            }}
          >
            {active.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Step {STEPS.findIndex((s) => s.id === active.id) + 1} of {STEPS.length}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.75 }}>
              {active.title}
            </Typography>
            <Typography variant="body1" sx={{ mb: 1, lineHeight: 1.6 }}>
              {active.plain}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              {active.detail}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <CheckCircleOutlineIcon color="success" fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                What engines cover
              </Typography>
            </Stack>
            <Stack spacing={1}>
              {COVERS.map((item) => (
                <Stack key={item} direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: 'success.main',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <BlockOutlinedIcon color="action" fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Design boundaries
              </Typography>
            </Stack>
            <Stack spacing={1}>
              {NOT_THIS.map((item) => (
                <Stack key={item} direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: 'text.disabled',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Paper
        variant="outlined"
        sx={{
          p: 2.5,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            See detection in the product
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Browse attack alerts with evidence, or open an agent for findings scoped to one device.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/alerts" variant="contained" size="small">
            Alerts
          </Button>
          <Button component={RouterLink} to="/agents" variant="outlined" size="small">
            Agents
          </Button>
          <Button component={RouterLink} to="/how-it-works" variant="text" size="small">
            How it works
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
