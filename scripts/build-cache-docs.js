import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateJobs, refreshIntervalMs } from "../src-v2/lib/job-sources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const dataDirectory = path.join(rootDirectory, "docs", "data");
const cacheFile = path.join(dataDirectory, "jobs-cache.json");

function buildNextWeekdayRefreshTimestamp(fromDate = new Date()) {
  const date = new Date(fromDate);
  const scheduleHoursUtc = [0, 6, 12, 18];

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateDate = new Date(date);
    candidateDate.setUTCDate(candidateDate.getUTCDate() + dayOffset);
    candidateDate.setUTCMinutes(0, 0, 0);

    const weekday = candidateDate.getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }

    for (const hour of scheduleHoursUtc) {
      candidateDate.setUTCHours(hour, 0, 0, 0);
      if (candidateDate.getTime() > date.getTime()) {
        return candidateDate.toISOString();
      }
    }
  }

  return new Date(date.getTime() + refreshIntervalMs).toISOString();
}

async function main() {
  await fs.mkdir(dataDirectory, { recursive: true });

  let previousHistory = {};

  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    previousHistory = cached.history ?? {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const snapshot = await aggregateJobs({ previousHistory });

  await fs.writeFile(
    cacheFile,
    JSON.stringify(
      {
        jobs: snapshot.jobs,
        sourceSummaries: snapshot.sourceSummaries,
        stats: snapshot.stats,
        history: snapshot.history,
        lastUpdated: snapshot.lastUpdated,
        nextScheduledRefreshAt: buildNextWeekdayRefreshTimestamp(new Date()),
        lastError: null,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Skrev ${snapshot.jobs.length} jobb till ${cacheFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
