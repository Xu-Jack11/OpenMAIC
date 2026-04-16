/**
 * AgentNodeCard — renders a single node from the agent activity tree.
 *
 * Uses the existing ai-element primitives (Shimmer for running labels,
 * collapsible for children/tool calls). Designed to be composed recursively
 * inside `AgentActivityTree`.
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { AgentActivityNode } from '@/lib/generation/agent/types';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleXIcon,
  ClockIcon,
  Loader2Icon,
  WrenchIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface AgentNodeCardProps {
  node: AgentActivityNode;
  children?: ReactNode;
  defaultOpen?: boolean;
}

const STATUS_ICON: Record<AgentActivityNode['status'], ReactNode> = {
  pending: <ClockIcon className="size-3.5 text-muted-foreground" />,
  running: <Loader2Icon className="size-3.5 animate-spin text-blue-500" />,
  succeeded: <CheckCircle2Icon className="size-3.5 text-green-600" />,
  failed: <CircleXIcon className="size-3.5 text-red-600" />,
};

function formatDuration(startedAt?: number, completedAt?: number): string | null {
  if (!startedAt) return null;
  const end = completedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentNodeCard({ node, children, defaultOpen = true }: AgentNodeCardProps) {
  const hasChildren = !!children;
  const hasToolCalls = node.toolCalls.length > 0;
  const isExpandable = hasChildren || hasToolCalls || !!node.textPreview || !!node.error;
  const duration = formatDuration(node.startedAt, node.completedAt);

  const label =
    node.status === 'running' ? (
      <Shimmer className="text-sm">{node.label}</Shimmer>
    ) : (
      <span className="text-sm">{node.label}</span>
    );

  const header = (
    <div className="flex w-full items-center gap-2">
      {STATUS_ICON[node.status]}
      {label}
      {node.outputSummary && node.status === 'succeeded' && (
        <Badge variant="secondary" className="text-[10px] font-normal">
          {node.outputSummary}
        </Badge>
      )}
      {duration && (
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{duration}</span>
      )}
      {isExpandable && (
        <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      )}
    </div>
  );

  if (!isExpandable) {
    return <div className="flex items-center gap-2 py-1">{header}</div>;
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild className="group">
        <button type="button" className="flex w-full cursor-pointer items-center gap-2 py-1">
          {header}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 space-y-1 border-muted border-l pl-3">
          {/* Error message */}
          {node.error && (
            <p className="text-xs text-red-600">
              <CircleXIcon className="mr-1 inline size-3" />
              {node.error}
            </p>
          )}

          {/* Tool calls */}
          {node.toolCalls.map((tc) => (
            <div key={tc.id} className="flex items-center gap-1.5 py-0.5 text-xs">
              <WrenchIcon className="size-3 text-muted-foreground" />
              <span className="font-medium">{tc.name}</span>
              {tc.status === 'running' && (
                <Loader2Icon className="size-3 animate-spin text-blue-500" />
              )}
              {tc.status === 'succeeded' && <CheckCircle2Icon className="size-3 text-green-600" />}
              {tc.status === 'failed' && <CircleXIcon className="size-3 text-red-600" />}
              {tc.resultSummary && (
                <span className="text-muted-foreground">{tc.resultSummary}</span>
              )}
            </div>
          ))}

          {/* Streaming text preview */}
          {node.textPreview && (
            <p className="line-clamp-3 text-xs text-muted-foreground italic">{node.textPreview}</p>
          )}

          {/* Recursive children (rendered by parent AgentActivityTree) */}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
