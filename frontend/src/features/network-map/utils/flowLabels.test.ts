import { flowNodeTooltip, formatFlowNodeLabel } from './flowLabels';

describe('formatFlowNodeLabel', () => {
  it('formats domain-correlated flows', () => {
    expect(formatFlowNodeLabel('TCP/443 github.com')).toBe('github.com:443');
  });

  it('formats raw IP flows', () => {
    expect(formatFlowNodeLabel('TCP/443 → 140.82.112.26')).toBe('140.82.112.26:443');
  });
});

describe('flowNodeTooltip', () => {
  it('explains domain flows in plain language', () => {
    expect(flowNodeTooltip('TCP/443 github.com')).toBe('Open TCP connection to github.com on port 443');
  });
});
