import { AgentActionPayload } from './agentActionDisplay';
import { AgentActionTreeNode } from './agentActionTree';
import { HostEvidenceItem } from './agentActionHostEvidence';

export type MergedToolGroup = {
  nodes: AgentActionTreeNode[];
};

export type MergedHostGroup = {
  items: HostEvidenceItem[];
};

function toolMergeKey(payload: AgentActionPayload): string {
  const tool = String(payload.tool || '').trim().toLowerCase();
  const channel = String(payload.channel || '').trim().toUpperCase();
  return `${channel}|${tool}`;
}

/** Collapse consecutive tools that share the same channel + tool name. */
export function mergeConsecutiveTools(nodes: AgentActionTreeNode[]): MergedToolGroup[] {
  const groups: MergedToolGroup[] = [];
  for (const node of nodes) {
    const key = toolMergeKey(node.payload as AgentActionPayload);
    const last = groups[groups.length - 1];
    if (last && toolMergeKey(last.nodes[0].payload as AgentActionPayload) === key) {
      last.nodes.push(node);
      continue;
    }
    groups.push({ nodes: [node] });
  }
  return groups;
}

function hostMergeKey(item: HostEvidenceItem): string {
  // Within a turn, consecutive rows of the same kind (process/file/…) are one run.
  return item.kind;
}

/** Collapse consecutive host evidence rows with the same kind + title. */
export function mergeConsecutiveHostEvidence(items: HostEvidenceItem[]): MergedHostGroup[] {
  const groups: MergedHostGroup[] = [];
  for (const item of items) {
    const key = hostMergeKey(item);
    const last = groups[groups.length - 1];
    if (last && hostMergeKey(last.items[0]) === key) {
      last.items.push(item);
      continue;
    }
    groups.push({ items: [item] });
  }
  return groups;
}
