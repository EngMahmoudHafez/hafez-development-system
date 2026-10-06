import { inspectProject } from './inspector.mjs';
import { loadProjectState } from './state.mjs';

function requiredGateProblems(managed) {
  const required = new Set(
    (managed.project.gates ?? [])
      .filter((gate) => gate.required)
      .map((gate) => gate.id),
  );
  if (managed.project.policies?.architectureProfile) required.add('architecture-structure');

  return Object.entries(managed.state.gates ?? {})
    .filter(([id, status]) => required.has(id) && ['failed', 'unavailable', 'skipped'].includes(status))
    .map(([id, status]) => ({ id, status }));
}

function chooseNextAction(report, managed) {
  if (!managed) return 'Preview adoption with `hafez adopt .`, then apply it with `hafez adopt . --apply`.';
  if (report.git.dirty) return 'Review and verify the current uncommitted changes before delegating new work.';
  if (managed.state.blockers?.length) return `Resolve blocker ${managed.state.blockers[0].id ?? 'listed in state'} first.`;
  const gateProblems = requiredGateProblems(managed);
  if (gateProblems.length) return `Repair required quality gate ${gateProblems[0].id} (${gateProblems[0].status}) and rerun verification.`;
  if (managed.state.activeSlice) return `Continue ${managed.state.activeSlice} from its acceptance criteria and latest handoff.`;
  return managed.state.nextSafeAction || report.inference.nextSafeAction;
}

export async function resumeProject(inputPath = '.') {
  const report = await inspectProject(inputPath);
  const managed = await loadProjectState(report.root);
  const currentSourceRevision = report.git.sourceRevision ?? report.git.revision;
  const staleRevision = Boolean(
    managed?.state.lastKnownGoodRevision
      && currentSourceRevision
      && managed.state.lastKnownGoodRevision !== currentSourceRevision,
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
