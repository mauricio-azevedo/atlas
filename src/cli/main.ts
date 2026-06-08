import { buildPrBrief, renderBriefMarkdown } from '../brief.js';
import { GitHubClient } from '../github.js';

async function main() {
  const [, , command, repository, prNumberRaw] = process.argv;

  if (command !== 'brief' || !repository || !prNumberRaw) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const prNumber = Number(prNumberRaw);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('PR number must be a positive integer.');
  }

  const github = new GitHubClient(process.env.GITHUB_TOKEN);
  const snapshot = await github.getPullRequestSnapshot(repository, prNumber);
  const brief = buildPrBrief(snapshot);

  process.stdout.write(renderBriefMarkdown(brief));
}

function printUsage() {
  process.stderr.write('Usage:\n  npm run brief -- owner/repo 123\n');
}

await main();
