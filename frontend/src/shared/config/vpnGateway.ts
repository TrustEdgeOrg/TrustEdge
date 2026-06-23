/** ISO country code for the WireGuard gateway on the client map (centroid marker). */
export function resolveVpnGatewayCountry(): string {
  const raw = (process.env.REACT_APP_VPN_GATEWAY_COUNTRY || 'US').trim().toUpperCase();
  return raw || 'US';
}

export function resolveVpnGatewayLabel(): string {
  const raw = (process.env.REACT_APP_VPN_GATEWAY_LABEL || 'VPN gateway').trim();
  return raw || 'VPN gateway';
}

export const VPN_GATEWAY_COUNTRY = resolveVpnGatewayCountry();
export const VPN_GATEWAY_LABEL = resolveVpnGatewayLabel();
