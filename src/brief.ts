import type { PullRequestSnapshot, WorkflowRun } from './github.js';

export const PROJECT_BRIEF_SCHEMA_VERSION = 'atlas.projectBrief.v1';

export type BriefStatus = 'ready' | 'attention' | 'blocked';
export type Confidence = 'low' | 'medium' | 'high';

export type ValidationSignal = {
  label: string;
  status: 'passed' | 'failed' | 'neutral' | 'unknown';
  summary: string;
  sourceUrl?: string;
  isBaselineFailure?: boolean;
};

export type BriefFinding = {
  kind: 'fact' | 'risk' | 'decision' | 'recommendation' | 'unknown';
  title: string;
  summary: string;
  confidence: Confidence;
  sourceUrl: string;
};

export type ReviewFocusArea = {
  label: string;
  summary: string;
  files: string[];
};

export type ProjectBrief = {
  schemaVersion: typeof PROJECT_BRIEF_SCHEMA_VERSION;
  subject: string;
  repository: string;
  status: BriefStatus;
  confidence: Confidence;
  executiveSummary: string;
  validation: ValidationSignal[];
  reviewFocus: ReviewFocusArea[];
  findings: BriefFinding[];
  nextSteps: BriefFinding[];
  changedFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  sources: Array<{ label: string; url: string }>;
};

export function buildPrBrief(snapshot: PullRequestSnapshot, validation: ValidationSignal[] = []): ProjectBrief {
  const pr = snapshot.pullRequest;
  const allValidation = [...buildWorkflowValidationSignals(snapshot.workflowRuns), ...validation];
  const reviewFocus = buildReviewFocus(snapshot);
  const status = classifyStatus(snapshot, allValidation);
  const sourceUrl = pr.html_url;

  return {
    schemaVersion: PROJECT_BRIEF_SCHEMA_VERSION,
    subject: `PR #${pr.number}: ${pr.title}`,
    repository: snapshot.repository,
    status,
    confidence: 'medium',
    executiveSummary: buildExecutiveSummary(snapshot, status, allValidation),
    validation: allValidation,
    reviewFocus,
    changedFiles: snapshot.files.map((file) => ({
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    findings: [
      {
        kind: 'fact',
        title: 'Pull request scope',
        summary: `The PR changes ${pr.changed_files} files with ${pr.additions} additions and ${pr.deletions} deletions.`,
        confidence: 'high',
        sourceUrl,
      },
      ...buildRiskFindings(snapshot, reviewFocus),
      ...buildValidationFindings(snapshot, allValidation),
    ],
    nextSteps: buildNextSteps(snapshot, status, reviewFocus),
    sources: [{ label: `PR #${pr.number}`, url: sourceUrl }],
  };
}

function buildReviewFocus(snapshot: PullRequestSnapshot): ReviewFocusArea[] {
  const groupedFiles = new Map<string, string[]>();

  for (const file of snapshot.files) {
    const area = classifyFileArea(file.filename);
    groupedFiles.set(area, [...(groupedFiles.get(area) ?? []), file.filename]);
  }

  return REVIEW_FOCUS_AREA_ORDER.flatMap((area) => {
    const files = groupedFiles.get(area) ?? [];

    if (files.length === 0) {
      return [];
    }

    return [
      {
        label: area,
        summary: buildReviewFocusSummary(area, files),
        files,
      },
    ];
  });
}

const REVIEW_FOCUS_AREA_ORDER = [
  'Global visual system',
  'App shell and navigation',
  'UI primitives',
  'Home and feed',
  'Groups',
  'Matches',
  'Profile and users',
  'Other',
] as const;

function classifyFileArea(path: string): (typeof REVIEW_FOCUS_AREA_ORDER)[number] {
  if (path.endsWith('/globals.css') || path.endsWith('/layout.tsx')) {
    return 'Global visual system';
  }

  if (path.includes('/components/app-shell') || path.includes('/components/bottom-nav')) {
    return 'App shell and navigation';
  }

  if (path.includes('/components/ui/') || path.includes('/components/page-header')) {
    return 'UI primitives';
  }

  if (path.endsWith('/src/app/page.tsx') || path.includes('/features/feed/')) {
    return 'Home and feed';
  }

  if (path.includes('/features/groups/')) {
    return 'Groups';
  }

  if (path.includes('/features/matches/')) {
    return 'Matches';
  }

  if (path.includes('/features/profile/') || path.includes('/features/users/')) {
    return 'Profile and users';
  }

  return 'Other';
}

function buildReviewFocusSummary(area: string, files: string[]) {
  const count = `${files.length} file${files.length === 1 ? '' : 's'}`;

  switch (area) {
    case 'Global visual system':
      return `${count} affecting global styling, metadata, or app-level layout.`;
    case 'App shell and navigation':
      return `${count} affecting the persistent shell or primary navigation.`;
    case 'UI primitives':
      return `${count} affecting shared components used across multiple screens.`;
    case 'Home and feed':
      return `${count} affecting the home surface or activity feed.`;
    case 'Groups':
      return `${count} affecting group discovery, group detail, or group membership surfaces.`;
    case 'Matches':
      return `${count} affecting match lists, match entry, or match presentation.`;
    case 'Profile and users':
      return `${count} affecting profile or user identity surfaces.`;
    default:
      return `${count} outside Atlas' current area classifier.`;
  }
}

function buildWorkflowValidationSignals(workflowRuns: WorkflowRun[]): ValidationSignal[] {
  return workflowRuns.map((run) => ({
    label: run.name ?? `Workflow run ${run.id}`,
    status: mapWorkflowRunStatus(run),
    summary: buildWorkflowRunSummary(run),
    sourceUrl: run.html_url,
  }));
}

function mapWorkflowRunStatus(run: WorkflowRun): ValidationSignal['status'] {
  if (run.status !== 'completed') {
    return 'unknown';
  }

  if (run.conclusion === 'success') {
    return 'passed';
  }

  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'action_required') {
    return 'failed';
  }

  return 'neutral';
}

function buildWorkflowRunSummary(run: WorkflowRun) {
  if (run.status !== 'completed') {
    return `GitHub Actions run is ${run.status}.`;
  }

  return `GitHub Actions run completed with conclusion: ${run.conclusion ?? 'unknown'}.`;
}

function classifyStatus(snapshot: PullRequestSnapshot, validation: ValidationSignal[]): BriefStatus {
  const pr = snapshot.pullRequest;

  if (pr.state === 'closed' && !pr.merged) {
    return 'blocked';
  }

  if (pr.mergeable === false) {
    return 'blocked';
  }

  const failingSignals = validation.filter((signal) => signal.status === 'failed' && !signal.isBaselineFailure);

  if (failingSignals.length > 0) {
    return 'attention';
  }

  if (pr.draft) {
    return 'attention';
  }

  if (pr.changed_files >= 20 || pr.additions + pr.deletions >= 800) {
    return 'attention';
  }

  return 'ready';
}

function buildExecutiveSummary(
  snapshot: PullRequestSnapshot,
  status: BriefStatus,
  validation: ValidationSignal[],
) {
  const pr = snapshot.pullRequest;
  const passedSignals = validation.filter((signal) => signal.status === 'passed');
  const baselineFailures = validation.filter((signal) => signal.status === 'failed' && signal.isBaselineFailure);
  const directFailures = validation.filter((signal) => signal.status === 'failed' && !signal.isBaselineFailure);

  const validationSummary = [
    passedSignals.length > 0 ? `${passedSignals.length} validation signal(s) passed` : null,
    baselineFailures.length > 0 ? `${baselineFailures.length} failure(s) are marked as baseline debt` : null,
    directFailures.length > 0 ? `${directFailures.length} failure(s) require attention` : null,
  ]
    .filter(Boolean)
    .join('; ');

  return [
    `PR #${pr.number} changes ${pr.changed_files} files`,
    `with ${pr.additions} additions and ${pr.deletions} deletions.`,
    `Atlas classifies it as ${status}.`,
    validationSummary ? `Validation: ${validationSummary}.` : 'No explicit validation signals were provided.',
  ].join(' ');
}

function buildRiskFindings(snapshot: PullRequestSnapshot, reviewFocus: ReviewFocusArea[]): BriefFinding[] {
  const pr = snapshot.pullRequest;
  const findings: BriefFinding[] = [];

  if (pr.draft) {
    findings.push({
      kind: 'risk',
      title: 'PR is still in draft',
      summary: 'Draft PRs should not be treated as ready until the author explicitly moves them to review.',
      confidence: 'high',
      sourceUrl: pr.html_url,
    });
  }

  if (pr.mergeable === false) {
    findings.push({
      kind: 'risk',
      title: 'PR is not mergeable',
      summary: 'GitHub reports this PR as not mergeable. Check conflicts or required checks.',
      confidence: 'high',
      sourceUrl: pr.html_url,
    });
  }

  if (pr.changed_files >= 20 || pr.additions + pr.deletions >= 800) {
    findings.push({
      kind: 'risk',
      title: 'Large review surface',
      summary: 'The PR is large enough that hidden regressions are more likely. Prefer focused review by flow or subsystem.',
      confidence: 'medium',
      sourceUrl: pr.html_url,
    });
  }

  const userFacingReviewFocus = reviewFocus.filter((area) => area.label !== 'Other');

  if (userFacingReviewFocus.length >= 4) {
    findings.push({
      kind: 'risk',
      title: 'Broad user-facing review surface',
      summary: `The PR touches ${userFacingReviewFocus.length} user-facing review areas: ${userFacingReviewFocus.map((area) => area.label).join(', ')}. Validate the primary flows across affected surfaces, not just individual files.`,
      confidence: 'medium',
      sourceUrl: pr.html_url,
    });
  }

  return findings;
}

function buildValidationFindings(
  snapshot: PullRequestSnapshot,
  validation: ValidationSignal[],
): BriefFinding[] {
  const pr = snapshot.pullRequest;

  return validation.map((signal) => {
    if (signal.status === 'failed' && signal.isBaselineFailure) {
      return {
        kind: 'decision' as const,
        title: `${signal.label} is baseline debt`,
        summary: `${signal.summary} Atlas will not treat this as a regression introduced by the PR.`,
        confidence: 'medium' as const,
        sourceUrl: signal.sourceUrl ?? pr.html_url,
      };
    }

    if (signal.status === 'failed') {
      return {
        kind: 'risk' as const,
        title: `${signal.label} failed`,
        summary: signal.summary,
        confidence: 'medium' as const,
        sourceUrl: signal.sourceUrl ?? pr.html_url,
      };
    }

    if (signal.status === 'passed') {
      return {
        kind: 'fact' as const,
        title: `${signal.label} passed`,
        summary: signal.summary,
        confidence: 'medium' as const,
        sourceUrl: signal.sourceUrl ?? pr.html_url,
      };
    }

    return {
      kind: 'unknown' as const,
      title: `${signal.label} is unclear`,
      summary: signal.summary,
      confidence: 'low' as const,
      sourceUrl: signal.sourceUrl ?? pr.html_url,
    };
  });
}

function buildNextSteps(
  snapshot: PullRequestSnapshot,
  status: BriefStatus,
  reviewFocus: ReviewFocusArea[],
): BriefFinding[] {
  const pr = snapshot.pullRequest;

  if (status === 'ready') {
    const broadReviewSurface = reviewFocus.filter((area) => area.label !== 'Other').length >= 4;

    return [
      {
        kind: 'recommendation',
        title: broadReviewSurface ? 'Proceed with focused human review' : 'Proceed to human review',
        summary: broadReviewSurface
          ? 'No blocking signal was detected, but the PR touches multiple user-facing areas. Review the affected flows listed in Review focus before merge.'
          : 'No blocking GitHub metadata or validation signal was detected. Product and UX intent still need human judgment.',
        confidence: 'medium',
        sourceUrl: pr.html_url,
      },
    ];
  }

  return [
    {
      kind: 'recommendation',
      title: 'Resolve attention items before merge',
      summary: 'Atlas detected at least one risk signal. Review the finding list before merging.',
      confidence: 'medium',
      sourceUrl: pr.html_url,
    },
  ];
}

export function renderBriefMarkdown(brief: ProjectBrief) {
  return [
    `# Atlas Brief — ${brief.subject}`,
    '',
    `Repository: **${brief.repository}**`,
    `Status: **${brief.status}**`,
    `Confidence: **${brief.confidence}**`,
    '',
    '## Executive summary',
    '',
    brief.executiveSummary,
    '',
    '## Validation',
    '',
    ...renderValidation(brief.validation),
    '',
    '## Review focus',
    '',
    ...renderReviewFocus(brief.reviewFocus),
    '',
    '## Changed files',
    '',
    ...brief.changedFiles.map((file) => `- \`${file.path}\` — ${file.status}, +${file.additions}/-${file.deletions}`),
    '',
    '## Findings',
    '',
    ...brief.findings.flatMap(renderFinding),
    '## Next steps',
    '',
    ...brief.nextSteps.flatMap(renderFinding),
    '## Sources',
    '',
    ...brief.sources.map((source) => `- [${source.label}](${source.url})`),
    '',
  ].join('\n');
}

function renderValidation(validation: ValidationSignal[]) {
  if (validation.length === 0) {
    return ['No explicit validation signals were provided.'];
  }

  return validation.map((signal) => {
    const baseline = signal.isBaselineFailure ? ' baseline debt' : '';
    return `- **${signal.label}**: ${signal.status}${baseline} — ${signal.summary}`;
  });
}

function renderReviewFocus(reviewFocus: ReviewFocusArea[]) {
  if (reviewFocus.length === 0) {
    return ['No changed files were classified into review areas.'];
  }

  return reviewFocus.flatMap((area) => [
    `### ${area.label}`,
    '',
    area.summary,
    '',
    ...area.files.map((file) => `- \`${file}\``),
    '',
  ]);
}

function renderFinding(finding: BriefFinding) {
  return [
    `### ${finding.title}`,
    '',
    `Kind: **${finding.kind}**`,
    `Confidence: **${finding.confidence}**`,
    '',
    finding.summary,
    '',
    `Source: ${finding.sourceUrl}`,
    '',
  ];
}
