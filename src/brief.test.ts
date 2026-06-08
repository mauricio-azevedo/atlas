import assert from 'node:assert/strict';
import { PROJECT_BRIEF_SCHEMA_VERSION, buildPrBrief, type ValidationSignal } from './brief.js';
import type { PullRequestSnapshot, WorkflowRun } from './github.js';

const readySnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  files: ['src/file-1.ts', 'src/file-2.ts', 'src/file-3.ts'],
  additions: 120,
  deletions: 30,
});

const readyBrief = buildPrBrief(readySnapshot);

assert.equal(readyBrief.schemaVersion, PROJECT_BRIEF_SCHEMA_VERSION);
assert.equal(readyBrief.status, 'ready');
assert.deepEqual(readyBrief.sources, [
  {
    label: 'PR #123',
    url: 'https://github.com/owner/repo/pull/123',
    kind: 'pull_request',
  },
]);
assert.deepEqual(readyBrief.findings[0]?.sources, readyBrief.sources);

const baselineFailure: ValidationSignal = {
  label: 'web lint',
  status: 'failed',
  summary: 'Lint fails on main as well, so this is baseline debt.',
  isBaselineFailure: true,
};

const baselineBrief = buildPrBrief(readySnapshot, [baselineFailure]);

assert.equal(baselineBrief.status, 'ready');
assert.deepEqual(
  baselineBrief.findings.find((finding) => finding.title === 'web lint is baseline debt')?.sources,
  [
    {
      label: 'web lint',
      url: 'https://github.com/owner/repo/pull/123',
      kind: 'manual_validation',
    },
  ],
);

const directFailure: ValidationSignal = {
  label: 'web build',
  status: 'failed',
  summary: 'Build failed on this branch.',
};

assert.equal(buildPrBrief(readySnapshot, [directFailure]).status, 'attention');

const successfulWorkflowSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  files: ['src/file-1.ts', 'src/file-2.ts', 'src/file-3.ts'],
  additions: 120,
  deletions: 30,
  workflowRuns: [makeWorkflowRun({ conclusion: 'success' })],
});

const successfulWorkflowBrief = buildPrBrief(successfulWorkflowSnapshot);

assert.equal(successfulWorkflowBrief.status, 'ready');
assert.match(successfulWorkflowBrief.executiveSummary, /1 validation signal\(s\) passed/);
assert.deepEqual(
  successfulWorkflowBrief.findings.find((finding) => finding.title === 'Quality passed')?.sources,
  [
    {
      label: 'Quality',
      url: 'https://github.com/owner/repo/actions/runs/1',
      kind: 'workflow_run',
    },
  ],
);

const failedWorkflowSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  files: ['src/file-1.ts', 'src/file-2.ts', 'src/file-3.ts'],
  additions: 120,
  deletions: 30,
  workflowRuns: [makeWorkflowRun({ conclusion: 'failure' })],
});

assert.equal(buildPrBrief(failedWorkflowSnapshot).status, 'attention');

const broadSurfaceSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  files: [
    'web/src/app/globals.css',
    'web/src/components/bottom-nav.tsx',
    'web/src/components/page-header.tsx',
    'web/src/components/ui/button.tsx',
    'web/src/features/feed/components/feed-item-card.tsx',
    'web/src/features/groups/components/group-detail-tabs.tsx',
    'web/src/features/matches/components/matches-list.tsx',
    'web/src/features/profile/components/profile-header.tsx',
  ],
  additions: 120,
  deletions: 30,
});

const broadSurfaceBrief = buildPrBrief(broadSurfaceSnapshot);

assert.deepEqual(
  broadSurfaceBrief.reviewFocus.map((area) => area.label),
  [
    'Global visual system',
    'App shell and navigation',
    'UI primitives',
    'Home and feed',
    'Groups',
    'Matches',
    'Profile and users',
  ],
);
assert.deepEqual(
  broadSurfaceBrief.reviewFocus.find((area) => area.label === 'UI primitives')?.files,
  ['web/src/components/page-header.tsx', 'web/src/components/ui/button.tsx'],
);
assert.equal(
  broadSurfaceBrief.findings.some(
    (finding) =>
      finding.title === 'Broad user-facing review surface' &&
      finding.summary.includes('7 user-facing review areas') &&
      !finding.summary.includes('Other') &&
      finding.sources[0]?.kind === 'pull_request',
  ),
  true,
);
assert.equal(broadSurfaceBrief.nextSteps[0]?.title, 'Proceed with focused human review');
assert.equal(broadSurfaceBrief.nextSteps[0]?.sources[0]?.kind, 'pull_request');

const draftSnapshot = makeSnapshot({
  draft: true,
  mergeable: true,
  files: ['src/file-1.ts', 'src/file-2.ts', 'src/file-3.ts'],
  additions: 120,
  deletions: 30,
});

assert.equal(buildPrBrief(draftSnapshot).status, 'attention');

const unmergeableSnapshot = makeSnapshot({
  draft: false,
  mergeable: false,
  files: ['src/file-1.ts', 'src/file-2.ts', 'src/file-3.ts'],
  additions: 120,
  deletions: 30,
});

assert.equal(buildPrBrief(unmergeableSnapshot).status, 'blocked');

const largeSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  files: Array.from({ length: 25 }, (_, index) => `src/file-${index}.ts`),
  additions: 500,
  deletions: 350,
});

assert.equal(buildPrBrief(largeSnapshot).status, 'attention');

function makeSnapshot({
  draft,
  mergeable,
  files,
  additions,
  deletions,
  workflowRuns = [],
}: {
  draft: boolean;
  mergeable: boolean | null;
  files: string[];
  additions: number;
  deletions: number;
  workflowRuns?: WorkflowRun[];
}): PullRequestSnapshot {
  return {
    repository: 'owner/repo',
    pullRequest: {
      number: 123,
      title: 'Example PR',
      state: 'open',
      draft,
      merged: false,
      mergeable,
      html_url: 'https://github.com/owner/repo/pull/123',
      body: null,
      additions,
      deletions,
      changed_files: files.length,
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'feature', sha: 'head-sha' },
    },
    files: files.map((filename) => ({
      filename,
      status: 'modified',
      additions: Math.floor(additions / files.length),
      deletions: Math.floor(deletions / files.length),
      changes: Math.floor((additions + deletions) / files.length),
    })),
    workflowRuns,
  };
}

function makeWorkflowRun({ conclusion }: { conclusion: WorkflowRun['conclusion'] }): WorkflowRun {
  return {
    id: 1,
    name: 'Quality',
    status: 'completed',
    conclusion,
    html_url: 'https://github.com/owner/repo/actions/runs/1',
    head_sha: 'head-sha',
  };
}
