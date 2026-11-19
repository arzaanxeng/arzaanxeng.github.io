// Writes data/github-contributions.json — the data behind the heatmap in index.html.
//
// Run by .github/workflows/github-activity.yml on a schedule. GitHub's contribution
// calendar is only available through the GraphQL API, which requires a token; running it
// here (server side) keeps that token out of the website.
//
//   GITHUB_TOKEN=... node scripts/fetch-github-contributions.mjs [username]
//
// The date window must match calendarWindow() in index.html: the same calendar date one
// year ago, plus one day, through today (UTC) — so the page's total equals this file's total.

import { mkdir, writeFile } from 'node:fs/promises';

const DAY = 86400000;
const QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;

/** @returns {{start: Date, end: Date}} UTC midnights, inclusive on both ends */
export function calendarWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yearAgo = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate()));
  return { start: new Date(yearAgo.getTime() + DAY), end };
}

/** Flattens GraphQL weeks into [{date, count}] limited to the window, oldest first. */
export function flattenCalendar(calendar, start, end) {
  const lo = start.toISOString().slice(0, 10);
  const hi = end.toISOString().slice(0, 10);
  return calendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => d.date >= lo && d.date <= hi)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function main() {
  const user = process.argv[2] || process.env.GH_USER || 'arzaanxeng';
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const now = new Date();
  const { start, end } = calendarWindow(now);

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'portfolio-activity' },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: user, from: start.toISOString(), to: now.toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(body.errors)}`);
  const calendar = body.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`No contribution calendar returned for "${user}"`);

  const contributions = flattenCalendar(calendar, start, end);
  const total = contributions.reduce((sum, d) => sum + d.count, 0);

  await mkdir('data', { recursive: true });
  await writeFile(
    'data/github-contributions.json',
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        user,
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        total,
        contributions,
      },
      null,
      0
    ) + '\n'
  );
  console.log(`Wrote ${contributions.length} days, ${total} contributions for ${user}`);
}

// Only run when executed directly (so the helpers above can be imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
