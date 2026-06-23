import { LiveClientRow } from '../hooks/useLiveClients';
import { countryCodeToMapPoint } from './countryCentroids';

export type MapPoint = { x: number; y: number };

export type CountryTrafficFlow = {
  countryCode: string;
  countryName: string | null;
  from: MapPoint;
  to: MapPoint;
  path: string;
  totalMibPerSec: number;
  rxMibPerSec: number;
  txMibPerSec: number;
  activeCount: number;
  clientCount: number;
};

/** Quadratic arc between two map points (bulges perpendicular to the chord). */
export function trafficArcPath(from: MapPoint, to: MapPoint, bulgeFactor = 0.22): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) {
    return '';
  }
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const bulge = Math.min(dist * bulgeFactor, 90);
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = mx + nx * bulge;
  const cy = my + ny * bulge;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

export function arcStrokeWidth(totalMibPerSec: number): number {
  if (!Number.isFinite(totalMibPerSec) || totalMibPerSec <= 0) {
    return 1.25;
  }
  return Math.min(5, 1.25 + totalMibPerSec * 1.75);
}

type CountryMarkerInput = {
  countryCode: string;
  countryName: string | null;
  x: number;
  y: number;
  clients: LiveClientRow[];
  activeCount: number;
};

export function buildCountryTrafficFlows(
  markers: CountryMarkerInput[],
  gateway: MapPoint,
  gatewayCountryCode: string,
): CountryTrafficFlow[] {
  const gatewayCode = gatewayCountryCode.trim().toUpperCase();
  const flows: CountryTrafficFlow[] = [];

  for (const marker of markers) {
    const countryCode = marker.countryCode.trim().toUpperCase();
    let rxMibPerSec = 0;
    let txMibPerSec = 0;
    for (const client of marker.clients) {
      if (!client.bandwidth) {
        continue;
      }
      rxMibPerSec += client.bandwidth.rx_mib_per_sec;
      txMibPerSec += client.bandwidth.tx_mib_per_sec;
    }
    const totalMibPerSec = rxMibPerSec + txMibPerSec;
    const hasActivity = marker.activeCount > 0 || totalMibPerSec > 0;
    if (!hasActivity) {
      continue;
    }

    const from = { x: marker.x, y: marker.y };
    const to = gateway;
    if (countryCode === gatewayCode) {
      continue;
    }

    const path = trafficArcPath(from, to);
    if (!path) {
      continue;
    }

    flows.push({
      countryCode,
      countryName: marker.countryName,
      from,
      to,
      path,
      totalMibPerSec,
      rxMibPerSec,
      txMibPerSec,
      activeCount: marker.activeCount,
      clientCount: marker.clients.length,
    });
  }

  return flows.sort((a, b) => b.totalMibPerSec - a.totalMibPerSec);
}

export function resolveGatewayMapPoint(countryCode: string): MapPoint | null {
  return countryCodeToMapPoint(countryCode);
}
