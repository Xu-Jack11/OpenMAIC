/**
 * AgentActivityTree — hierarchical view of classroom generation progress.
 *
 * Renders the tree of agent activity nodes maintained by
 * `useAgentActivityStore`. Each node is an `AgentNodeCard` with recursive
 * children. The component connects to the SSE event stream via
 * `useAgentActivityStream` when a `jobId` is provided.
 *
 * Phase C integration: drop this component into the generation-preview page
 * (or any view that shows a classroom generation job). It replaces the old
 * 2-milestone `GeneratingProgress` card with a full activity tree.
 */

'use client';

import { cn } from '@/lib/utils/cn';
import {
  useAgentActivityStream,
  useAgentActivity,
  type StreamStatus,
} from '@/lib/generation/agent/client-stream';
import { selectChildren } from '@/lib/store/agent-activity';
import { useAgentActivityStore } from '@/lib/store/agent-activity';
import { AgentNodeCard } from './agent-node-card';
import type { AgentActivityNode } from '@/lib/generation/agent/types';
import { CheckCircle2Icon, Loader2Icon, RadioIcon, WifiOffIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { getClientTranslation } from '@/lib/i18n';

export interface AgentActivityTreeProps {
  /** Job ID to connect the SSE stream. Pass `null` to render without a live connection. */
  jobId: string | null;
  /** Additional CSS classes on the root wrapper. */
  className?: string;
}

const STATUS_LABEL: Record<StreamStatus, { icon: ReactNode; label: string }> = {
  idle: { icon: <RadioIcon className="size-3.5 text-muted-foreground" />, label: 'Idle' },
  connecting: {
    icon: <Loader2Icon className="size-3.5 animate-spin text-blue-500" />,
    label: 'Connecting...',
  },
  open: {
    icon: <Loader2Icon className="size-3.5 animate-spin text-blue-500" />,
    label: '',
  },
  closed: {
    icon: <CheckCircle2Icon className="size-3.5 text-green-600" />,
    label: '',
  },
  error: {
    icon: <WifiOffIcon className="size-3.5 text-red-600" />,
    label: '',
  },
};

function NodeRecursive({ node }: { node: AgentActivityNode }) {
  const children = useAgentActivityStore((s) => selectChildren(s, node.id));
  return (
    <AgentNodeCard node={node} defaultOpen={node.status === 'running' || children.length <= 4}>
      {children.map((child) => (
        <NodeRecursive key={child.id} node={child} />
      ))}
    </AgentNodeCard>
  );
}

export function AgentActivityTree({ jobId, className }: AgentActivityTreeProps) {
  const { status } = useAgentActivityStream(jobId);
  const { rootIds, nodes, classroomResult, hasActivity } = useAgentActivity();

  const statusInfo = STATUS_LABEL[status];

  // Compute aggregate counts.
  const allNodes = Object.values(nodes);
  const runningCount = allNodes.filter((n) => n.status === 'running').length;
  const succeededCount = allNodes.filter((n) => n.status === 'succeeded').length;
  const failedCount = allNodes.filter((n) => n.status === 'failed').length;

  return (
    <div className={cn('w-full space-y-3', className)}>
      {/* Header bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {statusInfo.icon}
        {status === 'open' && (
          <span>
            {getClientTranslation('generation.generation.aiWorking')}{' '}
            {runningCount > 0 && `(${runningCount} active)`}
          </span>
        )}
        {status === 'closed' && classroomResult && (
          <span className="text-green-700">
            {getClientTranslation('generation.generation.generationComplete')} —{' '}
            {classroomResult.scenesCount} scenes
          </span>
        )}
        {status === 'error' && (
          <span className="text-red-600">
            {getClientTranslation('generation.generation.generationFailed')}
          </span>
        )}
        {statusInfo.label && <span>{statusInfo.label}</span>}

        {/* Counters */}
        {hasActivity && (
          <span className="ml-auto tabular-nums">
            {succeededCount > 0 && (
              <span className="mr-2 text-green-700">{succeededCount} done</span>
            )}
            {failedCount > 0 && <span className="text-red-600">{failedCount} failed</span>}
          </span>
        )}
      </div>

      {/* Tree body */}
      {hasActivity ? (
        <div className="space-y-1">
          {rootIds.map((id) => {
            const node = nodes[id];
            if (!node) return null;
            return <NodeRecursive key={id} node={node} />;
          })}
        </div>
      ) : (
        status !== 'idle' && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {getClientTranslation('generation.generation.aiWorking')}...
          </p>
        )
      )}
    </div>
  );
}
