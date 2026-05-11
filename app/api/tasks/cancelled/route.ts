import { NextRequest } from 'next/server';
import { deleteCancelledTasks, getActiveProject } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Bulk-prune cancelled tasks.
 *
 * Query params:
 * - `project=active` (default) scopes to the currently-active project
 * - `project=all` removes across every project
 * - `project=<id>` scopes to a specific project
 * - `older_than_hours=<n>` only removes tasks older than n hours (default 0)
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const param = searchParams.get('project');
  let projectId: string | undefined;
  if (param === 'all') projectId = undefined;
  else if (param && param !== 'active') projectId = param;
  else projectId = getActiveProject()?.id;

  const olderThanHours = Number(searchParams.get('older_than_hours') ?? '0');
  const olderThanMs = Number.isFinite(olderThanHours) && olderThanHours > 0
    ? olderThanHours * 60 * 60 * 1000
    : 0;

  const { removed } = deleteCancelledTasks({ projectId, olderThanMs });
  return Response.json({ removed, projectId: projectId ?? null });
}
