import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildPrBrief, renderBriefMarkdown, type ProjectBrief, type SourceKind, type ValidationSignal } from '../brief.js';
import { GitHubClient } from '../github.js';

type OutputFormat = 'markdown' | 'json';

async function main() {
  const [, , command, repository, prNumberRaw, ...flags] = process.argv;

  if (command !== 'brief' || !repository || !prNumberRaw) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const prNumber = Number(prNumberRaw);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('PR number must be a positive integer.');
  }

  const validationPath = getFlagValue(flags, '--validation');
  const validation = validationPath ? await loadValidationSignals(validationPath) : [];
  const format = parseOutputFormat(getFlagValue(flags, '--format'));
  const outputPath = getFlagValue(flags, '--output');

  const github = new GitHubClient(process.env.GITHUB_TOKEN);
  const snapshot = await github.getPullRequestSnapshot(repository, prNumber);
  const brief = buildPrBrief(snapshot, validation);
  const rendered = renderBrief(brief, format);

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, 'utf8');
    return;
  }

  process.stdout.write(rendered);
}

function renderBrief(brief: ProjectBrief, format: OutputFormat) {
  if (format === 'json') {
    return `${JSON.stringify(brief, null, 2)}\n`;
  }

  return renderBriefMarkdown(brief);
}

async function loadValidationSignals(path: string): Promise<ValidationSignal[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Validation file must contain an array of validation signals.');
  }

  return parsed.map(parseValidationSignal);
}

function parseValidationSignal(value: unknown): ValidationSignal {
  if (!value || typeof value !== 'object') {
    throw new Error('Validation signal must be an object.');
  }

  const signal = value as Record<string, unknown>;

  if (typeof signal.label !== 'string' || !signal.label.trim()) {
    throw new Error('Validation signal requires a non-empty string label.');
  }

  if (
    signal.status !== 'passed' &&
    signal.status !== 'failed' &&
    signal.status !== 'neutral' &&
    signal.status !== 'unknown'
  ) {
    throw new Error(`Invalid validation status for ${signal.label}.`);
  }

  if (typeof signal.summary !== 'string' || !signal.summary.trim()) {
    throw new Error(`Validation signal ${signal.label} requires a non-empty string summary.`);
  }

  if (signal.sourceUrl !== undefined && typeof signal.sourceUrl !== 'string') {
    throw new Error(`Validation signal ${signal.label} sourceUrl must be a string when provided.`);
  }

  if (signal.sourceKind !== undefined && !isSourceKind(signal.sourceKind)) {
    throw new Error(`Validation signal ${signal.label} sourceKind must be pull_request, workflow_run, or manual_validation.`);
  }

  if (signal.isBaselineFailure !== undefined && typeof signal.isBaselineFailure !== 'boolean') {
    throw new Error(`Validation signal ${signal.label} isBaselineFailure must be a boolean when provided.`);
  }

  return {
    label: signal.label,
    status: signal.status,
    summary: signal.summary,
    sourceUrl: signal.sourceUrl,
    sourceKind: signal.sourceKind,
    isBaselineFailure: signal.isBaselineFailure,
  };
}

function isSourceKind(value: unknown): value is SourceKind {
  return value === 'pull_request' || value === 'workflow_run' || value === 'manual_validation';
}

function parseOutputFormat(value: string | null): OutputFormat {
  if (!value) {
    return 'markdown';
  }

  if (value === 'markdown' || value === 'json') {
    return value;
  }

  throw new Error('--format must be either markdown or json.');
}

function getFlagValue(flags: string[], name: string) {
  const index = flags.indexOf(name);

  if (index === -1) {
    return null;
  }

  const value = flags[index + 1];

  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function printUsage() {
  process.stderr.write(
    'Usage:\n  npm run brief -- owner/repo 123 [--validation validation.json] [--format markdown|json] [--output file]\n',
  );
}

await main();
