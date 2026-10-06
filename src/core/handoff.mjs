import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { inspectProject } from './inspector.mjs';
import { loadProjectState, saveState } from './state.mjs';
import { isoFileTimestamp } from '../lib/files.mjs';

function renderHandoff(report, state) {
  const changed = report.git.changedFiles?.map((file) => `- ${file}`).join('\n') || '- None';
  const blockers = state.blockers?.map((item) => `- ${item.id ?? 'blocker'}: ${item.summary ?? JSON.stringify(item)}`).join('\n') || '- None';
  return `# Project handoff\n\n- Generated: ${new Date().toISOString()}\n- Repository revision: ${report.git.revision ?? 'unknown'}\n- Source revision: ${report.git.sourceRevision ?? report.git.revision ?? 'unknown'}\n- Branch: ${report.git.branch ?? 'unknown'}\n- Workflow state: ${state.workflowState}\n- Current focus: ${state.currentFocus}\n- Active slice: ${state.activeSlice ?? 'none'}\n\n## Changed files\n\n${changed}\n\n## Gates\n\n\`\`\`json\n${JSON.stringify(state.gates ?? {}, null, 2)}\n\`\`\`\n\n## Blockers\n\n${blockers}\n\n## Next safe action\n\n${state.nextSafeAction}\n`;
}

export async function createHandoff(root) {
  const managed = await loadProjectState(root);
  if (!managed) throw new Error('Project is not adopted. Run `hafez adopt . --apply` first.');
  const report = await inspectProject(root);
  const filePath = path.join(root, 'docs', 'hafez', 'handoffs', `${isoFileTimestamp()}.md`);
  await writeFile(filePath, renderHandoff(report, managed.state));
  managed.state.lastHandoff = path.relative(root, filePath);
  managed.state.workflowState = 'handed-off';
  await saveState(root, managed.state);
  return { filePath, nextSafeAction: managed.state.nextSafeAction };
}
