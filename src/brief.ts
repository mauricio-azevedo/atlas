import type { PullRequestSnapshot } from './github.js';

export type BriefStatus = 'ready' | 'attention' | 'blocked';
export type Confidence = 'low' | 'medium' | 'high';

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

export function buildPrBrief(snapshot: PullRequestSnapshot): ProjectBrief {
  const pr = snapshot.pullRequest;
  const status = classifyStatus(snapshot);
  const sourceUrl = pr.html_url;

  return {
    subject: `PR #${pr.number}: ${pr.title}`,
    repository: snapshot.repository,
    status,
    confidence: 'medium',
    executiveSummary: [
      `PR #${pr.number} changes ${pr.changed_files} files`,
      `with ${pr.additions} additions and ${pr.deletions} deletions.`,
      `Atlas classifies it as ${status}.`,
    ].join(' '),
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
    ],
    nextSteps: buildNextSteps(snapshot, status),
    sources: [{ label: `PR #${pr.number}`, url: sourceUrl }],
  };
}

function classifyStatus(snapshot: PullRequestSnapshot): BriefStatus {
  const pr = snapshot.pullRequest;

  if (pr.state === 'closed' && !pr.merged) {
    return 'blocked';
  }

  if (pr.mergeable === false) {
    return 'blocked';
  }

  if (pr.draft) {
    return 'attention';
  }

  if (pr.changed_files >= 20 || pr.additions + pr.deletions >= 800) {
    return 'attention';
  }

  return 'ready';
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

function buildNextSteps(snapshot: PullRequestSnapshot, status: BriefStatus): BriefFinding[] {
  const pr = snapshot.pullRequest;

  if (status === 'ready') {
    return [
      {
        kind: 'recommendation',
        title: 'Proceed to human review',
        summary: 'No blocking GitHub metadata signal was detected. Product and UX intent still need human judgment.',
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
