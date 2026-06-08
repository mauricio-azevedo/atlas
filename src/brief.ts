import type { PullRequestSnapshot } from './github.js';

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

export type ProjectBrief = {
  subject: string;
  repository: string;
  status: BriefStatus;
  confidence: Confidence;
  executiveSummary: string;
  validation: ValidationSignal[];
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
  const status = classifyStatus(snapshot, validation);
  const sourceUrl = pr.html_url;

  return {
    subject: `PR #${pr.number}: ${pr.title}`,
    repository: snapshot.repository,
    status,
    confidence: 'medium',
    executiveSummary: buildExecutiveSummary(snapshot, status, validation),
    validation,
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
      ...buildRiskFindings(snapshot),
      ...buildValidationFindings(snapshot, validation),
    ],
    nextSteps: buildNextSteps(snapshot, status),
    sources: [{ label: `PR #${pr.number}`, url: sourceUrl }],
  };
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

function buildRiskFindings(snapshot: PullRequestSnapshot): BriefFinding[] {
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

function buildNextSteps(snapshot: PullRequestSnapshot, status: BriefStatus): BriefFinding[] {
  const pr = snapshot.pullRequest;

  if (status === 'ready') {
    return [
      {
        kind: 'recommendation',
        title: 'Proceed to human review',
        summary: 'No blocking GitHub metadata or validation signal was detected. Product and UX intent still need human judgment.',
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
