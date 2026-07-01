import { flowNodeTooltip, formatFlowNodeLabel, parseFlowNode, portNodeTooltip } from './flowLabels';

describe('parseFlowNode', () => {
  it('parses domain-correlated backend label', () => {
    const parsed = parseFlowNode({
      id: 'flow:tcp:140.82.112.26:443',
      type: 'flow',
      label: 'TCP/443 github.com',
    });
    expect(parsed).toEqual({
      protocol: 'tcp',
      port: 443,
      destination: 'github.com',
      destinationKind: 'domain',
    });
  });
});

describe('formatFlowNodeLabel', () => {
  it('shows destination only after port split', () => {
    expect(formatFlowNodeLabel('TCP/443 github.com')).toBe('github.com');
  });

  it('formats raw IP flows', () => {
    expect(formatFlowNodeLabel('TCP/443 → 140.82.112.26')).toBe('140.82.112.26');
  });
});

describe('flowNodeTooltip', () => {
  it('explains domain flows in plain language', () => {
    expect(flowNodeTooltip('TCP/443 github.com')).toBe('Open TCP connection to github.com on port 443');
  });
});

describe('portNodeTooltip', () => {
  it('names well-known ports', () => {
    expect(portNodeTooltip(443)).toContain('443');
    expect(portNodeTooltip(443)).toContain('HTTPS');
  });
});
