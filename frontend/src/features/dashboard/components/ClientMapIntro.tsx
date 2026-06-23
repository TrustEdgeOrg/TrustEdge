import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export default function ClientMapIntro() {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1.5 }}>
        <InfoOutlinedIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.75 }}>
            Why this map is useful
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            TrustEdge records each client&apos;s <strong>physical location at VPN enroll</strong>{' '}
            (public IP → GeoIP). That is the same signal used for{' '}
            <strong>Country access</strong> rules (who may enroll, and what destinations they may
            reach). This map gives you a geographic view of your fleet—not which websites look
            &quot;foreign&quot; in DNS.
          </Typography>
          <Stack
            component="ul"
            sx={{
              m: 0,
              pl: 2.25,
              color: 'text.secondary',
              '& li': { mb: 0.75, typography: 'body2' },
            }}
          >
            <li>
              <strong>Verify policy at a glance</strong> — see if blocked login countries (e.g.
              IR) actually have clients trying to connect, or if IL users are on the network before
              applying destination rules.
            </li>
            <li>
              <strong>Spot travel and roaming</strong> — multiple countries or new flags after a
              trip can explain alerts or changed behavior.
            </li>
            <li>
              <strong>Group by country quickly</strong> — click a flag to list every client with
              that VPN login country, then open a profile for details.
            </li>
            <li>
              <strong>Inspect the gateway</strong> — click the amber <strong>VPN</strong> pin for EC2
              endpoint, pool, DNS gateway, and live peer counts from the control plane.
            </li>
            <li>
              <strong>See who is live</strong> — a green ring means at least one client in that
              country had recent DNS activity on the network.
            </li>
            <li>
              <strong>Follow VPN traffic</strong> — green arcs from a country flag to the amber{' '}
              <strong>VPN gateway</strong> pin show live tunnel throughput (width + animation scale
              with MiB/s). This is a logical view, not a literal cable route.
            </li>
          </Stack>
        </Box>
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
        <Chip size="small" variant="outlined" label="Flag = VPN login country" />
        <Chip size="small" variant="outlined" label="Number = clients in country" />
        <Chip
          size="small"
          variant="outlined"
          label="Green ring = active now"
          sx={{
            borderColor: 'success.main',
            color: 'success.main',
          }}
        />
        <Chip
          size="small"
          variant="outlined"
          label="Amber pin = VPN gateway"
          sx={{
            borderColor: 'warning.main',
            color: 'warning.main',
          }}
        />
        <Chip
          size="small"
          variant="outlined"
          label="Green arc = live tunnel traffic"
          sx={{
            borderColor: 'success.main',
            color: 'success.main',
          }}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Not on this map: DNS-inferred countries (ccTLD heuristics)—see{' '}
        <Typography
          component={RouterLink}
          to="/client-profiles"
          variant="caption"
          color="primary"
          sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
        >
          Client profiles
        </Typography>
        . Clients without enroll geo appear in the counter above the map only.
      </Typography>

      <Stack direction="row" flexWrap="wrap" gap={1}>
        <Button
          component={RouterLink}
          to="/policy/countries"
          size="small"
          variant="outlined"
        >
          Country access policy
        </Button>
        <Button component={RouterLink} to="/client-profiles" size="small" variant="text">
          Client profiles
        </Button>
      </Stack>
    </Paper>
  );
}
