import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ScienceIcon from '@mui/icons-material/Science';
import PolicyPackDomainsDialog from '../features/policy/components/PolicyPackDomainsDialog';
import PackTogglePreviewDialog from '../features/twin/components/PackTogglePreviewDialog';
import { policyApi } from '../features/policy/config/api';
import { PolicyPack, PolicyProfile } from '../features/policy/types/policy';
import { usePolicyDnsSync } from '../features/policy/hooks/usePolicyDnsSync';

export default function PolicyPage() {
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [profiles, setProfiles] = useState<PolicyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [viewPack, setViewPack] = useState<PolicyPack | null>(null);
  const [previewPack, setPreviewPack] = useState<PolicyPack | null>(null);

  const {
    syncStatusLabel,
    applying,
    applyError,
    setApplyError,
    applyInfo,
    setApplyInfo,
    applyNow,
    loadSyncStatus,
  } = usePolicyDnsSync();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pr] = await Promise.all([policyApi.listPacks(), policyApi.listProfiles()]);
      setPacks(p);
      setProfiles(pr);
      await loadSyncStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policy');
    } finally {
      setLoading(false);
    }
  }, [loadSyncStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePackUpdated = (updated: PolicyPack) => {
    setPacks((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
  };

  const togglePack = async (pack: PolicyPack) => {
    setSavingSlug(pack.slug);
    setInfo(null);
    try {
      const updated = await policyApi.updatePack(pack.slug, !pack.enabled_globally);
      setPacks((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
      setInfo(
        `${updated.name} saved. Enforcement sync runs automatically (dns-sync + dnsmasq reload).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update pack');
    } finally {
      setSavingSlug(null);
    }
  };

  const applyPackFromPreview = async (pack: PolicyPack, enabledGlobally: boolean) => {
    setSavingSlug(pack.slug);
    setInfo(null);
    const updated = await policyApi.updatePack(pack.slug, enabledGlobally);
    setPacks((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
    setInfo(
      `${updated.name} saved. Enforcement sync runs automatically (dns-sync + dnsmasq reload).`,
    );
    setSavingSlug(null);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 960 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 600 }}>
            Policy
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Preview impact on live traffic before applying desired state. Changes sync to dnsmasq via
            the host listener when applied.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {syncStatusLabel}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={applyNow}
          disabled={applying}
        >
          Apply now
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}
      {applyError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setApplyError(null)}>
          {applyError}
        </Alert>
      )}
      {applyInfo && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setApplyInfo(null)}>
          {applyInfo}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'flex-start' }}
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              List packs (network-wide)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              View each category to browse blocked domains. Use Preview impact before toggling
              enforcement.
            </Typography>
          </Box>
        </Stack>
        <Stack spacing={1.5}>
          {packs.map((pack) => {
            const packBusy = savingSlug === pack.slug;
            return (
              <Stack
                key={pack.slug}
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
                spacing={1}
                sx={{
                  py: 1,
                  px: 1,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {pack.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {pack.description}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent={{ xs: 'space-between', sm: 'flex-end' }}
                  sx={{ flexShrink: 0 }}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ScienceIcon />}
                    disabled={packBusy}
                    onClick={() => setPreviewPack(pack)}
                  >
                    Preview impact
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<VisibilityIcon />}
                    disabled={packBusy}
                    onClick={() => setViewPack(pack)}
                  >
                    View list
                  </Button>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Switch
                        checked={pack.enabled_globally}
                        disabled={packBusy}
                        onChange={() => togglePack(pack)}
                      />
                    }
                    label={pack.enabled_globally ? 'Enforced' : 'Off'}
                  />
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      </Paper>

      <PolicyPackDomainsDialog
        pack={viewPack}
        open={viewPack !== null}
        onClose={() => setViewPack(null)}
        onPackUpdated={handlePackUpdated}
      />

      <PackTogglePreviewDialog
        pack={previewPack}
        open={previewPack !== null}
        onClose={() => setPreviewPack(null)}
        onApply={applyPackFromPreview}
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          Device profiles
        </Typography>
        <Stack spacing={2} divider={<Divider flexItem />}>
          {profiles.map((profile) => (
            <Box key={profile.slug}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body1" fontWeight={600}>
                  {profile.name}
                </Typography>
                <Chip label={profile.slug} size="small" variant="outlined" />
                <Chip label={`Sensitivity: ${profile.behavior_sensitivity}`} size="small" />
                {profile.quarantine_on_abnormal && (
                  <Chip
                    label={`Quarantine ${profile.quarantine_hours}h`}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                )}
              </Stack>
              {profile.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {profile.description}
                </Typography>
              )}
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                {profile.enabled_pack_slugs.map((slug) => (
                  <Chip key={slug} label={slug} size="small" variant="outlined" />
                ))}
              </Stack>
              {profile.schedule_rules.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Schedule: {profile.schedule_rules[0].start}–{profile.schedule_rules[0].end} (
                  {profile.schedule_rules[0].pack_slugs.join(', ')})
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
