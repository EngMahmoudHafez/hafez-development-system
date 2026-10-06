import { inspectProject } from './inspector.mjs';
import { loadProjectState } from './state.mjs';

function chooseNextAction(report, managed) {
  if (!managed) return 'Preview adoption with `hafez adopt .`, then apply it with `hafez adopt . --apply`.';
  if (report.git.dirty) return 'Review and verify the current uncommitted changes before delegating new work.';
  if (managed.state.blockers?.length) return `Resolve blocker ${managed.state.blockers[0].id ?? 'listed in state'} first.`;
  if (Object.values(managed.state.gates ?? {}).includes('failed')) return 'Repair the failed quality gate and rerun verification.';
  if (managed.state.activeSlice) return `Continue ${managed.state.activeSlice} from its acceptance criteria and latest handoff.`;
  return managed.state.nextSafeAction || report.inference.nextSafeAction;
}

export async function resumeProject(inputPath = '.') {
  const report = await inspectProject(inputPath);
  const managed = await loadProjectState(report.root);
  const staleRevision = Boolean(
    managed?.state.lastKnownGoodRevision
      && report.git.revision
      && managed.state.lastKnownGoodRevision !== report.git.revision,
  );

  return {
    schemaVersion: 'hds-resume/v1',
    root: report.root,
    managed: Boolean(managed),
    workflowState: managed?.state.workflowState ?? 'unmanaged',
    currentFocus: managed?.state.currentFocus ?? report.inference.currentFocus,
    activeSlice: managed?.state.activeSlice ?? null,
    git: report.git,
    staleRevision,
    blockers: managed?.state.blockers ?? [],
    gates: managed?.state.gates ?? {},
    capabilities: managed?.capabilities.capabilities ?? [],
    nextSafeAction: chooseNextAction(report, managed),
  };
}
