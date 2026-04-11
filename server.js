import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { aggregateJobs, refreshIntervalMs } from "./src/lib/job-sources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDirectory = path.join(__dirname, "data");
const cacheFile = path.join(dataDirectory, "jobs-cache.json");

const state = {
  jobs: [],
  sourceSummaries: [],
  stats: {},
  history: {},
  lastUpdated: null,
  nextScheduledRefreshAt: null,
  lastError: null,
  isRefreshing: false,
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/data", express.static(path.join(__dirname, "data")));

async function ensureDataDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

async function persistCache() {
  await ensureDataDirectory();
  await fs.writeFile(
    cacheFile,
    JSON.stringify(
      {
        jobs: state.jobs,
        sourceSummaries: state.sourceSummaries,
        stats: state.stats,
        history: state.history,
        lastUpdated: state.lastUpdated,
        nextScheduledRefreshAt: state.nextScheduledRefreshAt,
        lastError: state.lastError,
      },
      null,
      2
    ),
    "utf8"
  );
}

async function loadCache() {
  await ensureDataDirectory();

  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    Object.assign(state, {
      jobs: cached.jobs ?? [],
      sourceSummaries: cached.sourceSummaries ?? [],
      stats: cached.stats ?? {},
      history: cached.history ?? {},
      lastUpdated: cached.lastUpdated ?? null,
      nextScheduledRefreshAt: cached.nextScheduledRefreshAt ?? null,
      lastError: cached.lastError ?? null,
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Kunde inte läsa cachefil:", error);
    }
  }
}

function buildNextRefreshTimestamp(fromDate = new Date()) {
  const refreshHoursUtc = [0, 6, 12, 18];
  const candidate = new Date(fromDate);

  while (true) {
    const day = candidate.getUTCDay();
    const isWeekday = day >= 1 && day <= 5;

    if (isWeekday) {
      for (const hour of refreshHoursUtc) {
        const slot = new Date(
          Date.UTC(
            candidate.getUTCFullYear(),
            candidate.getUTCMonth(),
            candidate.getUTCDate(),
            hour,
            0,
            0,
            0
          )
        );

        if (slot.getTime() > fromDate.getTime()) {
          return slot.toISOString();
        }
      }
    }

    candidate.setUTCDate(candidate.getUTCDate() + 1);
    candidate.setUTCHours(0, 0, 0, 0);
  }
}

function payload() {
  return {
    jobs: state.jobs,
    sourceSummaries: state.sourceSummaries,
    stats: state.stats,
    lastUpdated: state.lastUpdated,
    nextScheduledRefreshAt: state.nextScheduledRefreshAt,
    lastError: state.lastError,
    isRefreshing: state.isRefreshing,
  };
}

async function refreshJobs({ reason = "manual" } = {}) {
  if (state.isRefreshing) {
    return payload();
  }

  state.isRefreshing = true;
  state.lastError = null;
  let thrownError = null;

  try {
    const nextSnapshot = await aggregateJobs({ previousHistory: state.history });

    state.jobs = nextSnapshot.jobs;
    state.sourceSummaries = nextSnapshot.sourceSummaries;
    state.stats = nextSnapshot.stats;
    state.history = nextSnapshot.history;
    state.lastUpdated = nextSnapshot.lastUpdated;
    state.nextScheduledRefreshAt = buildNextRefreshTimestamp();

    await persistCache();

    console.log(
      `[refresh:${reason}] ${state.jobs.length} jobb hämtade från ${state.sourceSummaries.length} källor`
    );
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    await persistCache();
    thrownError = error;
  } finally {
    state.isRefreshing = false;
  }

  if (thrownError) {
    throw thrownError;
  }

  return payload();
}

app.get("/api/jobs", async (req, res) => {
  try {
    if (req.query.refresh === "1") {
      await refreshJobs({ reason: "query" });
    }

    res.json(payload());
  } catch (error) {
    res.status(500).json({
      ...payload(),
      error: error instanceof Error ? error.message : "Okänt fel",
    });
  }
});

app.post("/api/refresh", async (_req, res) => {
  try {
    const refreshed = await refreshJobs({ reason: "button" });
    res.json(refreshed);
  } catch (error) {
    res.status(500).json({
      ...payload(),
      error: error instanceof Error ? error.message : "Okänt fel",
    });
  }
});

app.get("/api/status", (_req, res) => {
  res.json(payload());
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

await loadCache();

if (!state.lastUpdated) {
  try {
    await refreshJobs({ reason: "startup" });
  } catch (error) {
    console.error("Första uppdateringen misslyckades:", error);
  }
}

setInterval(() => {
  refreshJobs({ reason: "schedule" }).catch((error) => {
    console.error("Schemalagd uppdatering misslyckades:", error);
  });
}, refreshIntervalMs);

state.nextScheduledRefreshAt ||= buildNextRefreshTimestamp();

app.listen(port, () => {
  console.log(`Läkarjobb-servern kör på http://localhost:${port}`);
});
