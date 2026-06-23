import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import BlockIcon from '@mui/icons-material/Block';
import IconButton from '@mui/material/IconButton';
import { devicesApi } from '../config/api';
import { policyApi } from '../../policy/config/api';
import { DevicePolicyAssignment, PolicyProfile } from '../../policy/types/policy';
import {
  BehaviorProfile,
  BehaviorReview,
  ClientBlockedDomain,
  Device,
  DeviceSecurityPolicy,
  DeviceCountrySummary,
} from '../types/device';
import { DnsAlert } from '../../dns-queries/types/dnsQuery';
import BaselineSummary from './BaselineSummary';
import DeviceCountriesSection from './DeviceCountriesSection';
import NetworkAttributionSection from './NetworkAttributionSection';
import DeviceLoginLocationSection from './DeviceLoginLocationSection';
import { countryLabel } from '../utils/countryDisplay';
import { DeviceLoginGeoSummary } from '../types/device';
import { formatShortDateTime } from '../../../shared/utils/dateUtils';
import { chromelessIconButtonSx } from '../../../shared/theme/chromelessIconButtonSx';

interface ClientProfileDetailProps {
  device: Device;
  countrySummary?: DeviceCountrySummary | null;
  loginGeoSummary?: DeviceLoginGeoSummary | null;
}

export default function ClientProfileDetail({
  device,
  countrySummary,
  loginGeoSummary,
}: ClientProfileDetailProps) {
  const [profile, setProfile] = useState<BehaviorProfile | null>(null);
  const [policy, setPolicy] = useState<DeviceSecurityPolicy | null>(null);
  const [blocks, setBlocks] = useState<ClientBlockedDomain[]>([]);
  const [events, setEvents] = useState<DnsAlert[]>([]);
  const [policyAssignment, setPolicyAssignment] = useState<DevicePolicyAssignment | null>(null);
  const [policyProfiles, setPolicyProfiles] = useState<PolicyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<BehaviorReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pol, b, ev, assign, profiles] = await Promise.all([
        devicesApi.getBehaviorProfile(device.id),
        devicesApi.getSecurityPolicy(device.id),
        devicesApi.listClientBlocks(device.id),
        devicesApi.getBehaviorEvents(device.id, 1, 10),
        devicesApi.getPolicyAssignment(device.id),
        policyApi.listProfiles(),
      ]);
      setProfile(p);
      setPolicy(pol);
      setBlocks(b);
      setEvents(ev.items);
      setPolicyAssignment(assign);
      setPolicyProfiles(profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [device.id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadReview = useCallback(
    async (refresh = false) => {
      setReviewLoading(true);
      setReviewError(null);
      try {
        const r = await devicesApi.getBehaviorReview(device.id, refresh);
        setReview(r);
      } catch (e) {
        setReviewError(e instanceof Error ? e.message : 'Failed to load behavior explanation');
      } finally {
        setReviewLoading(false);
      }
    },
    [device.id],
  );

  useEffect(() => {
    if (!loading && profile?.profile_ready) {
      loadReview();
    }
  }, [loading, profile?.profile_ready, loadReview]);

  const toggleAutoBlock = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const updated = await devicesApi.updateSecurityPolicy(device.id, {
        auto_block_enabled: !policy.auto_block_enabled,
      });
      setPolicy(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update policy');
    } finally {
      setSaving(false);
    }
  };

  const changePolicyProfile = async (slug: string) => {
    setSaving(true);
    try {
      const updated = await devicesApi.assignPolicyProfile(device.id, slug);
      setPolicyAssignment(updated);
      const pol = await devicesApi.getSecurityPolicy(device.id);
      setPolicy(pol);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign profile');
    } finally {
      setSaving(false);
    }
  };

  const applyPolicyAfterBlock = async () => {
    try {
      const result = await policyApi.applyPolicy();
      setActionMessage(result.message);
    } catch (e) {
      setActionMessage(
        e instanceof Error ? e.message : 'Block saved; policy sync may be delayed',
      );
    }
  };

  const startQuarantine = async () => {
    setSaving(true);
    setActionMessage(null);
    try {
      const result = await devicesApi.startQuarantine(device.id, 4);
      setPolicyAssignment({
        device_id: device.id,
        policy_profile_id: policyAssignment?.policy_profile_id ?? null,
        policy_profile_slug: policyAssignment?.policy_profile_slug ?? null,
        policy_profile_name: policyAssignment?.policy_profile_name ?? null,
        in_quarantine: result.in_quarantine,
        quarantine_expires_at: result.quarantine_expires_at,
      });
      setActionMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to quarantine client');
    } finally {
      setSaving(false);
    }
  };

  const endQuarantine = async () => {
    setSaving(true);
    setActionMessage(null);
    try {
      const result = await devicesApi.endQuarantine(device.id);
      setPolicyAssignment({
        device_id: device.id,
        policy_profile_id: policyAssignment?.policy_profile_id ?? null,
        policy_profile_slug: policyAssignment?.policy_profile_slug ?? null,
        policy_profile_name: policyAssignment?.policy_profile_name ?? null,
        in_quarantine: result.in_quarantine,
        quarantine_expires_at: result.quarantine_expires_at,
      });
      setActionMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end quarantine');
    } finally {
      setSaving(false);
    }
  };

  const revokeBlock = async (blockId: number) => {
    try {
      await devicesApi.revokeClientBlock(device.id, blockId);
      await load();
      await applyPolicyAfterBlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke block');
    }
  };

  const formatBlockSource = (source: string) => {
    if (source === 'admin_manual') return 'Admin';
    if (source === 'behavior_auto') return 'Behavior auto';
    if (source === 'forbidden_country') return 'Forbidden country';
    return source;
  };

  const label = device.hostname || device.client_ip;

  return (
    <Paper variant="outlined" sx={{ p: 3, minHeight: 400 }}>
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h5">{label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {device.client_ip}
              {device.mac_address ? ` · ${device.mac_address}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Source: {device.source}
            </Typography>
            {loginGeoSummary?.country_code && (
              <Typography variant="caption" color="text.secondary" display="block">
                Last VPN login from:{' '}
                {countryLabel(loginGeoSummary.country_code, loginGeoSummary.country_name)}
              </Typography>
            )}
            {countrySummary?.primary_country_code && (
              <Typography variant="caption" color="text.secondary" display="block">
                Primary DNS region:{' '}
                {countryLabel(
                  countrySummary.primary_country_code,
                  countrySummary.primary_country_name,
                )}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Stack direction="row" alignItems="center" spacing={0.25}>
              <Chip
                label={profile?.profile_ready ? 'Baseline ready' : 'Learning'}
                color={profile?.profile_ready ? 'success' : 'default'}
                variant="outlined"
              />
              <Tooltip
                title={
                  profile?.profile_ready
                    ? 'Enough DNS history exists. “Normal” stats refresh about every hour; recent activity is scored against them.'
                    : 'Collecting DNS history to learn this device’s normal patterns before anomaly scoring runs.'
                }
                arrow
              >
                <IconButton size="small" aria-label="About baseline status" sx={{ p: 0.25, ...chromelessIconButtonSx }}>
                  <HelpOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Stack>
            {profile?.last_score != null && (
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <Chip label={`Score: ${profile.last_score}`} color="warning" variant="outlined" />
                <Tooltip
                  title="0–100 unusual-activity score for the last ~15 minutes vs this baseline. At or above your policy threshold (often 70) can trigger a behavior alert."
                  arrow
                >
                  <IconButton size="small" aria-label="About behavior score" sx={{ p: 0.25, ...chromelessIconButtonSx }}>
                    <HelpOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
            {policyAssignment?.in_quarantine && (
              <Chip label="Blocked" color="error" />
            )}
            <Button size="small" onClick={load}>
              Refresh
            </Button>
          </Stack>
        </Stack>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {actionMessage && (
          <Alert severity="success" onClose={() => setActionMessage(null)}>
            {actionMessage}
          </Alert>
        )}

        {!loading && profile && (
          <>
            <Box>
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.5 }}>
                <Typography variant="subtitle1">Behavior baseline</Typography>
                <Tooltip
                  title="Learned “normal” DNS habits for this device. Each metric has a (?) with details. Stats update from recent history while the device is active."
                  arrow
                >
                  <IconButton size="small" aria-label="About behavior baseline" sx={{ p: 0.25, ...chromelessIconButtonSx }}>
                    <HelpOutlineIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              {profile.profile_ready && Object.keys(profile.baseline).length > 0 ? (
                <BaselineSummary baseline={profile.baseline} />
              ) : (
                <Alert severity="info" variant="outlined">
                  Profile is still learning. TrustEdge needs more DNS history before a baseline is
                  computed. (This threshold is configurable by the server.)
                </Alert>
              )}
              {profile.last_scored_at && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Last scored: {formatShortDateTime(profile.last_scored_at)}
                </Typography>
              )}
            </Box>

            <NetworkAttributionSection deviceId={device.id} />

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Block client
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Full block denies all VPN traffic and DNS for this device for 4 hours.
              </Typography>
              <Stack direction="row" spacing={1}>
                {policyAssignment?.in_quarantine ? (
                  <Button
                    color="success"
                    variant="contained"
                    startIcon={<BlockIcon />}
                    onClick={endQuarantine}
                    disabled={saving}
                  >
                    Unblock client
                  </Button>
                ) : (
                  <Button
                    color="error"
                    variant="contained"
                    startIcon={<BlockIcon />}
                    onClick={startQuarantine}
                    disabled={saving}
                  >
                    Block client (4h)
                  </Button>
                )}
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Policy profile
              </Typography>
              <FormControl size="small" sx={{ minWidth: 220 }} disabled={saving}>
                <InputLabel id="policy-profile-label">Profile</InputLabel>
                <Select
                  labelId="policy-profile-label"
                  label="Profile"
                  value={policyAssignment?.policy_profile_slug ?? 'teen'}
                  onChange={(e) => changePolicyProfile(e.target.value)}
                >
                  {policyProfiles.map((pr) => (
                    <MenuItem key={pr.slug} value={pr.slug}>
                      {pr.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {policyAssignment?.in_quarantine && policyAssignment.quarantine_expires_at && (
                <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
                  Full network block until{' '}
                  {formatShortDateTime(policyAssignment.quarantine_expires_at)}
                </Typography>
              )}
            </Box>

            <DeviceLoginLocationSection deviceId={device.id} />

            <DeviceCountriesSection deviceId={device.id} />

            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <AutoAwesomeOutlinedIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" sx={{ flex: 1 }}>
                  What this means
                </Typography>
                {review?.source === 'llm' && review.llm_model && (
                  <Chip size="small" label={review.llm_model} variant="outlined" color="primary" />
                )}
                {review && review.source !== 'llm' && review.review_mode !== 'template' && (
                  <Chip size="small" label="Rules-based fallback" variant="outlined" color="warning" />
                )}
                <Tooltip title="Regenerate explanation">
                  <span>
                    <Button
                      size="small"
                      startIcon={
                        reviewLoading ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />
                      }
                      onClick={() => loadReview(true)}
                      disabled={reviewLoading}
                    >
                      Refresh
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              {reviewLoading && !review && (
                <Typography variant="body2" color="text.secondary">
                  Generating explanation… On CPU this can take up to 2 minutes.
                </Typography>
              )}
              {reviewError && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {reviewError}
                </Alert>
              )}
              {review?.llm_error && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  AI error: {review.llm_error}
                </Alert>
              )}
              {review?.summary && (
                <Typography variant="body2" sx={{ lineHeight: 1.65 }}>
                  {review.summary}
                </Typography>
              )}
              {!reviewLoading && !review?.summary && profile.profile_ready && (
                <Typography variant="body2" color="text.secondary">
                  No explanation available yet.
                </Typography>
              )}
            </Box>

            {policy && (
              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Security policy
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={policy.auto_block_enabled}
                        onChange={toggleAutoBlock}
                        disabled={saving}
                      />
                    }
                    label="Auto-block domains on abnormal behavior"
                  />
                  <Tooltip
                    title="When the behavior score is very high, TrustEdge can temporarily block domains seen in that burst (in addition to policy packs)."
                    arrow
                  >
                    <IconButton size="small" aria-label="About auto-block" sx={{ p: 0.25, ...chromelessIconButtonSx }}>
                      <HelpOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Threshold: {policy.auto_block_threshold} · Max blocks/day:{' '}
                  {policy.max_blocks_per_day}
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Active per-device blocks
              </Typography>
              {blocks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No active domain blocks for this device.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {blocks.map((b) => (
                    <Box key={b.id}>
                      <ListItem
                        secondaryAction={
                          <Button size="small" onClick={() => revokeBlock(b.id)}>
                            Revoke
                          </Button>
                        }
                      >
                        <ListItemText
                          primary={b.domain}
                          secondary={
                            b.expires_at
                              ? `Expires ${formatShortDateTime(b.expires_at)} · ${formatBlockSource(b.source)} · score ${b.score ?? '—'}`
                              : `${formatBlockSource(b.source)} · score ${b.score ?? '—'}`
                          }
                        />
                      </ListItem>
                      <Divider />
                    </Box>
                  ))}
                </List>
              )}
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Recent behavior alerts
              </Typography>
              {events.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No behavior anomalies recorded for this device.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {events.map((ev) => (
                    <Box key={ev.id}>
                      <ListItem alignItems="flex-start">
                        <ListItemText
                          primary={ev.domain || ev.root_domain || '—'}
                          secondary={
                            <>
                              {formatShortDateTime(ev.timestamp)}
                              <br />
                              {ev.parent_summary || ev.message || '—'}
                            </>
                          }
                        />
                      </ListItem>
                      <Divider />
                    </Box>
                  ))}
                </List>
              )}
            </Box>
          </>
        )}
      </Stack>
    </Paper>
  );
}
