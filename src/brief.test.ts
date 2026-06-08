import assert from 'node:assert/strict';
import { buildPrBrief, type ValidationSignal } from './brief.js';
import type { PullRequestSnapshot, WorkflowRun } from './github.js';

const readySnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  changedFiles: 3,
  additions: 120,
  deletions: 30,
});

assert.equal(buildPrBrief(readySnapshot).status, 'ready');

const baselineFailure: ValidationSignal = {
  label: 'web lint',
  status: 'failed',
  summary: 'Lint fails on main as well, so this is baseline debt.',
  isBaselineFailure: true,
};

assert.equal(buildPrBrief(readySnapshot, [baselineFailure]).status, 'ready');

const directFailure: ValidationSignal = {
  label: 'web build',
  status: 'failed',
  summary: 'Build failed on this branch.',
};

assert.equal(buildPrBrief(readySnapshot, [directFailure]).status, 'attention');

const successfulWorkflowSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  changedFiles: 3,
  additions: 120,
  deletions: 30,
  workflowRuns: [makeWorkflowRun({ conclusion: 'success' })],
});

assert.equal(buildPrBrief(successfulWorkflowSnapshot).status, 'ready');
assert.match(buildPrBrief(successfulWorkflowSnapshot).executiveSummary, /1 validation signal\(s\) passed/);

const failedWorkflowSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  changedFiles: 3,
  additions: 120,
  deletions: 30,
  workflowRuns: [makeWorkflowRun({ conclusion: 'failure' })],
});

assert.equal(buildPrBrief(failedWorkflowSnapshot).status, 'attention');

const draftSnapshot = makeSnapshot({
  draft: true,
  mergeable: true,
  changedFiles: 3,
  additions: 120,
  deletions: 30,
});

assert.equal(buildPrBrief(draftSnapshot).status, 'attention');

const unmergeableSnapshot = makeSnapshot({
  draft: false,
  mergeable: false,
  changedFiles: 3,
  additions: 120,
  deletions: 30,
});

assert.equal(buildPrBrief(unmergeableSnapshot).status, 'blocked');

const largeSnapshot = makeSnapshot({
  draft: false,
  mergeable: true,
  changedFiles: 25,
  additions: 500,
  deletions: 350,
});

assert.equal(buildPrBrief(largeSnapshot).status, 'attention');

function makeSnapshot({
  draft,
  mergeable,
  changedFiles,
  additions,
  deletions,
  workflowRuns = [],
}: {
  draft: boolean;
  mergeable: boolean | null;
  changedFiles: number;
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
      changed_files: changedFiles,
      base: { ref: 'main', sha: 'base-sha' },
      head: { ref: 'feature', sha: 'head-sha' },
    },
    files: Array.from({ length: changedFiles }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: 'modified',
      additions: Math.floor(additions / changedFiles),
      deletions: Math.floor(deletions / changedFiles),
      changes: Math.floor((additions + deletions) / changedFiles),
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
