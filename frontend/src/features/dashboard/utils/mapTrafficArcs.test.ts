import {
  arcStrokeWidth,
  buildCountryTrafficFlows,
  trafficArcPath,
} from './mapTrafficArcs';

describe('trafficArcPath', () => {
  it('returns a quadratic path between two distant points', () => {
    const path = trafficArcPath({ x: 100, y: 200 }, { x: 400, y: 250 });
    expect(path).toMatch(/^M 100 200 Q .+ 400 250$/);
  });

  it('returns empty string when points are too close', () => {
    expect(trafficArcPath({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe('');
  });
});

describe('arcStrokeWidth', () => {
  it('scales with throughput', () => {
    expect(arcStrokeWidth(0)).toBe(1.25);
    expect(arcStrokeWidth(2)).toBeGreaterThan(arcStrokeWidth(0));
    expect(arcStrokeWidth(100)).toBeLessThanOrEqual(5);
  });
});

describe('buildCountryTrafficFlows', () => {
  it('aggregates bandwidth per country and skips gateway country', () => {
    const flows = buildCountryTrafficFlows(
      [
        {
          countryCode: 'IL',
          countryName: 'Israel',
          x: 550,
          y: 280,
          activeCount: 1,
          clients: [
            {
              client_ip: '10.0.0.2',
              hostname: 'laptop',
              mac_address: null,
              source: 'vpn_enroll',
              device_id: 1,
              vpn_login_country_code: 'IL',
              vpn_login_country_name: 'Israel',
              is_active_now: true,
              bandwidth: {
                rx_mib_per_sec: 0.5,
                tx_mib_per_sec: 0.2,
                total_mib_per_sec: 0.7,
                delta_rx_bytes: 0,
                delta_tx_bytes: 0,
                recorded_at: null,
              },
            },
          ],
        },
        {
          countryCode: 'US',
          countryName: 'United States',
          x: 220,
          y: 240,
          activeCount: 0,
          clients: [
            {
              client_ip: '10.0.0.3',
              hostname: null,
              mac_address: null,
              source: 'vpn_enroll',
              device_id: 2,
              vpn_login_country_code: 'US',
              vpn_login_country_name: 'United States',
              is_active_now: false,
              bandwidth: null,
            },
          ],
        },
      ],
      { x: 220, y: 240 },
      'US',
    );

    expect(flows).toHaveLength(1);
    expect(flows[0].countryCode).toBe('IL');
    expect(flows[0].totalMibPerSec).toBeCloseTo(0.7);
    expect(flows[0].path).toContain('Q');
  });
});
