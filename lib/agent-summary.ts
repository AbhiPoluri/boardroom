import { getLogsForAgent, saveAgentSummary, getAgentById } from './db';
import { getWorktreeGitInfo } from './worktree';

export async function generateAgentSummary(agentId: string): Promise<string> {
  const agent = getAgentById(agentId);
  if (!agent) return '';

  // Get last 50 log lines
  const logs = getLogsForAgent(agentId, 200);
  const stdoutLogs = logs.filter((l: any) => l.stream === 'stdout').slice(-50);
  const logText = stdoutLogs.map((l: any) => l.content).join('\n');

  // Get git info if available
  let filesChanged: string[] = [];
  let commits: string[] = [];

  if (agent.worktree_path) {
    try {
      const gitInfo = getWorktreeGitInfo(agent.worktree_path);
      if (gitInfo.changedFiles) {
        filesChanged = gitInfo.changedFiles.map((f: any) => `${f.status}: ${f.path}`);
      }
      if (gitInfo.recentCommits) {
        commits = gitInfo.recentCommits.map((c: any) => `${c.hash.slice(0, 7)} ${c.message}`);
      }
    } catch {}
  }

  // Build summary
  const parts: string[] = [];
  parts.push(`Agent "${agent.name}" (${agent.type}) — ${agent.status}`);
  parts.push(`Task: ${agent.task}`);

  if (commits.length > 0) {
    parts.push(`\nCommits (${commits.length}):`);
    commits.forEach(c => parts.push(`  ${c}`));
  }

  if (filesChanged.length > 0) {
    parts.push(`\nFiles changed (${filesChanged.length}):`);
    filesChanged.slice(0, 20).forEach(f => parts.push(`  ${f}`));
    if (filesChanged.length > 20) parts.push(`  ... and ${filesChanged.length - 20} more`);
  }

  // Extract key output (last meaningful lines)
  const meaningfulLines = stdoutLogs
    .map((l: any) => l.content.trim())
    .filter((l: string) => l.length > 5 && !l.startsWith('*') && !l.startsWith('─'));

  if (meaningfulLines.length > 0) {
    parts.push(`\nKey output:`);
    meaningfulLines.slice(-10).forEach((l: string) => parts.push(`  ${l}`));
  }

  const summary = parts.join('\n');

  // Save to DB
  saveAgentSummary(agentId, summary, filesChanged, commits, agent.status);

  return summary;
}
