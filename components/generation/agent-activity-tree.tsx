/**
 * AgentActivityTree — hierarchical view of classroom generation progress.
 *
 * Renders the tree of agent activity nodes maintained by
 * `useAgentActivityStore`. Each node is an `AgentNodeCard` with recursive
 * children. The component connects to the SSE event stream via
 * `useAgentActivityStream` when a `jobId` is provided.
 */

'use client';

import { memo, useMemo } from 'react';
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
import { useI18n } from '@/lib/hooks/use-i18n';

export interface AgentActivityTreeProps {
  jobId: string | null;
  className?: string;
}

function statusIcon(status: StreamStatus): ReactNode {
  switch (status) {
    case 'idle':
      return <RadioIcon className="size-3.5 text-muted-foreground" />;
    case 'connecting':
    case 'open':
      return <Loader2Icon className="size-3.5 animate-spin text-blue-500" />;
    case 'closed':
      return <CheckCircle2Icon className="size-3.5 text-green-600" />;
    case 'error':
      return <WifiOffIcon className="size-3.5 text-red-600" />;
  }
}

const NodeRecursive = memo(function NodeRecursive({ node }: { node: AgentActivityNode }) {
  const children = useAgentActivityStore((s) => selectChildren(s, node.id));
  const childCount = children.length;
  return (
    <AgentNodeCard
      node={node}
      defaultOpen={node.status === 'running' || childCount <= 4}
      childCount={childCount}
    >
      {children.map((child) => (
        <NodeRecursive key={child.id} node={child} />
      ))}
    </AgentNodeCard>
  );
});

export function AgentActivityTree({ jobId, className }: AgentActivityTreeProps) {
  const { t } = useI18n();
  const { status } = useAgentActivityStream(jobId);
  const { nodes, rootIds, classroomResult } = useAgentActivity();
  const hasActivity = rootIds.length > 0;

  // Single-pass aggregate counts.
  const { running, succeeded, failed } = useMemo(() => {
    let running = 0;
    let succeeded = 0;
    let failed = 0;
    for (const n of Object.values(nodes)) {
      if (n.status === 'running') running++;
      else if (n.status === 'succeeded') succeeded++;
      else if (n.status === 'failed') failed++;
    }
    return { running, succeeded, failed };
  }, [nodes]);

  return (
    <div className={cn('w-full space-y-3', className)}>
      {/* Header bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {statusIcon(status)}
        {status === 'connecting' && <span>{t('generation.generation.aiWorking')}...</span>}
        {status === 'open' && (
          <span>
            {t('generation.generation.aiWorking')}{' '}
            {running > 0 && `(${running} ${t('generation.generation.agentTreeActive')})`}
          </span>
        )}
        {status === 'closed' && classroomResult && (
          <span className="text-green-700">
            {t('generation.generation.generationComplete')} — {classroomResult.scenesCount}{' '}
            {t('generation.generation.agentTreeScenes')}
          </span>
        )}
        {status === 'error' && (
          <span className="text-red-600">{t('generation.generation.generationFailed')}</span>
        )}

        {/* Counters */}
        {hasActivity && (
          <span className="ml-auto tabular-nums">
            {succeeded > 0 && (
              <span className="mr-2 text-green-700">
                {succeeded} {t('generation.generation.agentTreeDone')}
              </span>
            )}
            {failed > 0 && (
              <span className="text-red-600">
                {failed} {t('generation.generation.agentTreeFailed')}
              </span>
            )}
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
            {t('generation.generation.aiWorking')}...
          </p>
        )
      )}
    </div>
  );
}
