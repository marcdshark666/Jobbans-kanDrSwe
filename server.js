import express from "express";
import crypto from "node:crypto";
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
const subscribersFile = path.join(dataDirectory, "subscribers.local.json");

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

const subscriptionState = {
  subscribers: [],
  updatedAt: null,
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/data", express.static(path.join(__dirname, "data")));

async function ensureDataDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function looksLikeEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createNotificationSettings(settings = {}) {
  const frequencyHours = Number(settings.frequencyHours ?? 6);
  const templates = Array.isArray(settings.templates)
    ? settings.templates.slice(0, 8)
    : ["stockholm", "uppsala", "hela-sverige"];
  const categories = Array.isArray(settings.categories)
    ? settings.categories.slice(0, 12)
    : ["Underläkare", "BT-läkare", "ST-läkare", "Legitimerad läkare", "Specialist"];
  return {
    enabled: Boolean(settings.enabled),
    frequencyHours: [6, 12, 24].includes(frequencyHours) ? frequencyHours : 6,
    templates: templates.length ? templates : ["stockholm", "uppsala", "hela-sverige"],
    categories: categories.length
      ? categories
      : ["Underläkare", "BT-läkare", "ST-läkare", "Legitimerad läkare", "Specialist"],
  };
}

function buildUnsubscribeToken() {
  return crypto.randomBytes(18).toString("hex");
}

function buildGoogleMapsLink({ origin, destination, modeId }) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);

  if (modeId === "driving") {
    url.searchParams.set("travelmode", "driving");
  } else if (modeId === "bicycling") {
    url.searchParams.set("travelmode", "bicycling");
  } else {
    url.searchParams.set("travelmode", "transit");
  }

  return url.toString();
}

function formatDuration(seconds = 0) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  return `${minutes} min`;
}

function estimateVisualWidth(seconds = 0) {
  if (!seconds) {
    return 34;
  }

  const minutes = Math.max(10, Math.round(seconds / 60));
  return Math.max(18, Math.min(100, Math.round((minutes / 180) * 100)));
}

function buildFallbackCommuteResults(origin, destination) {
  return [
    {
      id: "driving",
      label: "Bil",
      pill: "Bil",
      durationText: "Beräknas i Google Maps",
      distanceText: "Öppna länk för exakt restid",
      note: "Google Maps öppnas med biltrafik och aktuell vardagstrafik för den valda tiden.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "driving" }),
      visualWidth: 34,
    },
    {
      id: "bus",
      label: "Buss",
      pill: "Kollektivt",
      durationText: "Beräknas i Google Maps",
      distanceText: "Öppna länk för exakt restid",
      note: "Google Maps öppnas i kollektivtrafikläge. Buss och byten räknas där.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "bus" }),
      visualWidth: 34,
    },
    {
      id: "rail",
      label: "Tåg",
      pill: "Kollektivt",
      durationText: "Beräknas i Google Maps",
      distanceText: "Öppna länk för exakt restid",
      note: "Google Maps öppnas i kollektivtrafikläge. Tåg och byten räknas där.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "rail" }),
      visualWidth: 34,
    },
    {
      id: "bicycling",
      label: "Cykel",
      pill: "Cykel",
      durationText: "Beräknas i Google Maps",
      distanceText: "Öppna länk för exakt restid",
      note: "Google Maps öppnas i cykelläge så att du snabbt kan jämföra med andra alternativ.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "bicycling" }),
      visualWidth: 34,
    },
  ];
}

async function loadSubscriptions() {
  await ensureDataDirectory();

  try {
    const stored = JSON.parse(await fs.readFile(subscribersFile, "utf8"));
    subscriptionState.subscribers = Array.isArray(stored.subscribers) ? stored.subscribers : [];
    subscriptionState.updatedAt = stored.updatedAt ?? null;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Kunde inte läsa lokal prenumerationsfil:", error);
    }
  }
}

async function persistSubscriptions() {
  await ensureDataDirectory();
  await fs.writeFile(
    subscribersFile,
    JSON.stringify(
      {
        subscribers: subscriptionState.subscribers,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

function upsertSubscription({ email, notifications }) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  const existingIndex = subscriptionState.subscribers.findIndex(
    (subscriber) => normalizeEmail(subscriber.email) === normalizedEmail
  );
  const notificationSettings = createNotificationSettings(notifications);

  if (existingIndex >= 0) {
    subscriptionState.subscribers[existingIndex] = {
      ...subscriptionState.subscribers[existingIndex],
      email: normalizedEmail,
      notifications: notificationSettings,
      updatedAt: now,
      unsubscribedAt: notificationSettings.enabled ? null : subscriptionState.subscribers[existingIndex].unsubscribedAt,
    };

    return subscriptionState.subscribers[existingIndex];
  }

  const subscriber = {
    email: normalizedEmail,
    notifications: notificationSettings,
    unsubscribeToken: buildUnsubscribeToken(),
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    lastCheckedAt: null,
    lastEmailedAt: null,
    unsubscribedAt: null,
  };

  subscriptionState.subscribers.push(subscriber);
  return subscriber;
}

function unsubscribeByToken(token = "") {
  const subscriber = subscriptionState.subscribers.find((entry) => entry.unsubscribeToken === token);
  if (!subscriber) {
    return null;
  }

  subscriber.notifications = {
    ...subscriber.notifications,
    enabled: false,
  };
  subscriber.unsubscribedAt = new Date().toISOString();
  subscriber.updatedAt = new Date().toISOString();
  return subscriber;
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

async function fetchGoogleCommuteResults({ origin, destination, departureAt }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      results: buildFallbackCommuteResults(origin, destination),
      message:
        "Google Maps-nyckel saknas på servern. Därför visas färdiga länkar men inte exakta restider ännu.",
    };
  }

  const departureTime = Math.floor((toDate(departureAt) ?? new Date()).getTime() / 1000);
  const definitions = [
    { id: "driving", label: "Bil", pill: "Bil", mode: "driving" },
    { id: "bus", label: "Buss", pill: "Kollektivt", mode: "transit", transitMode: "bus" },
    { id: "rail", label: "Tåg", pill: "Kollektivt", mode: "transit", transitMode: "rail" },
    { id: "bicycling", label: "Cykel", pill: "Cykel", mode: "bicycling" },
  ];

  const results = await Promise.all(
    definitions.map(async (definition) => {
      const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
      url.searchParams.set("origin", origin);
      url.searchParams.set("destination", destination);
      url.searchParams.set("mode", definition.mode);
      url.searchParams.set("language", "sv");
      url.searchParams.set("region", "se");
      url.searchParams.set("key", apiKey);

      if (definition.mode !== "bicycling") {
        url.searchParams.set("departure_time", String(departureTime));
      }

      if (definition.transitMode) {
        url.searchParams.set("transit_mode", definition.transitMode);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google Maps HTTP ${response.status}`);
      }

      const payload = await response.json();
      const leg = payload.routes?.[0]?.legs?.[0];

      if (!leg) {
        return {
          id: definition.id,
          label: definition.label,
          pill: definition.pill,
          durationText: "Ingen rutt hittades",
          distanceText: "Kontrollera adressen",
          note: "Google Maps kunde inte hitta en tydlig rutt för den här kombinationen ännu.",
          link: buildGoogleMapsLink({ origin, destination, modeId: definition.id }),
          visualWidth: 20,
        };
      }

      const durationSeconds = leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0;
      const distanceText = leg.distance?.text ?? "Okänd distans";
      const summary = payload.routes?.[0]?.summary;

      return {
        id: definition.id,
        label: definition.label,
        pill: definition.pill,
        durationText: formatDuration(durationSeconds),
        distanceText,
        note: summary
          ? `Google Maps föreslår rutten via ${summary}.`
          : "Beräknat utifrån vald avresetid och aktuell ruttlogik i Google Maps.",
        link: buildGoogleMapsLink({ origin, destination, modeId: definition.id }),
        visualWidth: estimateVisualWidth(durationSeconds),
      };
    })
  );

  return {
    results,
    message: "Restider hämtade från Google Maps och klara att jämföra.",
  };
}

function matchesTemplatePreference(job, templates = []) {
  if (templates.includes("hela-sverige")) {
    return true;
  }

  if (templates.includes("stockholm") && job.stockholmMatch) {
    return true;
  }

  if (templates.includes("uppsala") && job.uppsalaMatch) {
    return true;
  }

  return false;
}

function getUniqueJobsForNotifications(jobs = []) {
  const grouped = new Map();

  jobs.forEach((job) => {
    const key = job.historyKey || job.duplicateHintKey || job.id;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...job,
        sourceNames: [job.sourceName].filter(Boolean),
      });
      return;
    }

    existing.sourceNames = Array.from(new Set([...existing.sourceNames, job.sourceName].filter(Boolean)));
    if (!existing.employer && job.employer) {
      existing.employer = job.employer;
    }
    if (!existing.startInfo && job.startInfo) {
      existing.startInfo = job.startInfo;
    }
  });

  return Array.from(grouped.values());
}

function buildNotificationEmailHtml(subscriber, jobsForSubscriber, baseUrl) {
  const unsubscribeLink = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/unsubscribe?token=${subscriber.unsubscribeToken}`
    : "";

  const items = jobsForSubscriber
    .map(
      (job) => `
        <li style="margin:0 0 18px;padding:0;list-style:none;">
          <div style="padding:16px;border:1px solid #d8e6ee;border-radius:16px;background:#ffffff;">
            <strong style="display:block;font-size:16px;color:#10212b;">${job.title}</strong>
            <span style="display:block;margin-top:6px;color:#45606c;font-size:13px;">
              ${job.category} · ${job.roleLabel ?? "Läkare"} · ${job.employer || "Arbetsgivare ej angiven"}
            </span>
            <span style="display:block;margin-top:4px;color:#45606c;font-size:13px;">
              ${job.location || "Okänd ort"} · ${job.sourceNames?.join(", ") || job.sourceName || "Okänd källa"}
            </span>
            <p style="margin:10px 0 0;color:#2d4754;font-size:14px;line-height:1.6;">
              ${job.roleSummary || "Ny matchande annons upptäckt."}
            </p>
            <a href="${job.link}" style="display:inline-block;margin-top:12px;color:#0f7c8c;text-decoration:none;font-weight:700;">
              Öppna annons
            </a>
          </div>
        </li>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f4f8fb;padding:24px;color:#10212b;">
      <div style="max-width:760px;margin:0 auto;">
        <h1 style="margin:0 0 8px;font-size:28px;">Nya läkarjobb matchar ditt konto</h1>
        <p style="margin:0 0 18px;line-height:1.6;color:#45606c;">
          Hej. Här är ${jobsForSubscriber.length} nya annons${jobsForSubscriber.length === 1 ? "" : "er"} som matchar dina val för ${subscriber.email}.
        </p>
        <ul style="margin:0;padding:0;">${items}</ul>
        ${
          unsubscribeLink
            ? `<p style="margin-top:18px;color:#45606c;font-size:13px;line-height:1.6;">
                 Vill du inte ha fler notiser? <a href="${unsubscribeLink}" style="color:#0f7c8c;">Avregistrera dig här</a>.
               </p>`
            : ""
        }
      </div>
    </div>
  `;
}

async function sendEmailNotifications(jobs = []) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM;

  if (!apiKey || !fromAddress || !subscriptionState.subscribers.length) {
    return;
  }

  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
  const uniqueJobs = getUniqueJobsForNotifications(jobs);
  const now = new Date();

  for (const subscriber of subscriptionState.subscribers) {
    if (!subscriber.notifications?.enabled || subscriber.unsubscribedAt) {
      continue;
    }

    const lastCheckedAt = toDate(subscriber.lastCheckedAt) ?? toDate(subscriber.confirmedAt) ?? new Date(0);
    const lastEmailedAt = toDate(subscriber.lastEmailedAt);
    const minimumGapMs = (subscriber.notifications.frequencyHours ?? 6) * 60 * 60 * 1000;

    if (lastEmailedAt && now.getTime() - lastEmailedAt.getTime() < minimumGapMs) {
      continue;
    }

    const relevantJobs = uniqueJobs.filter((job) => {
      const discoveredAt = toDate(job.firstSeenAt) ?? toDate(job.detectedAt) ?? toDate(job.lastUpdated);
      if (!discoveredAt || discoveredAt.getTime() <= lastCheckedAt.getTime()) {
        return false;
      }

      if (!matchesTemplatePreference(job, subscriber.notifications.templates ?? [])) {
        return false;
      }

      return (subscriber.notifications.categories ?? []).includes(job.category);
    });

    subscriber.lastCheckedAt = now.toISOString();

    if (!relevantJobs.length) {
      continue;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [subscriber.email],
        subject: `${relevantJobs.length} nya läkarjobb matchar dina filter`,
        html: buildNotificationEmailHtml(subscriber, relevantJobs, baseUrl),
      }),
    });

    if (response.ok) {
      subscriber.lastEmailedAt = now.toISOString();
      subscriber.updatedAt = now.toISOString();
    }
  }

  await persistSubscriptions();
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
    await sendEmailNotifications(state.jobs);

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

app.post("/api/subscriptions", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!looksLikeEmail(email)) {
      res.status(400).json({ error: "Ogiltig e-postadress" });
      return;
    }

    const subscription = upsertSubscription({
      email,
      notifications: req.body?.notifications ?? {},
    });
    await persistSubscriptions();

    res.json({
      message: `E-postnotiser är sparade för ${subscription.email}.`,
      subscription,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Okänt fel",
    });
  }
});

app.get("/unsubscribe", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) {
      res.status(400).send("<h1>Ogiltig avregistreringslänk</h1>");
      return;
    }

    const subscriber = unsubscribeByToken(token);
    if (!subscriber) {
      res.status(404).send("<h1>Kunde inte hitta prenumerationen</h1>");
      return;
    }

    await persistSubscriptions();
    res.send(`
      <!doctype html>
      <html lang="sv">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Avregistrerad</title>
        </head>
        <body style="font-family:Arial,sans-serif;padding:32px;background:#f4f8fb;color:#10212b;">
          <h1>Du är nu avregistrerad</h1>
          <p>Inga fler jobbnotiser skickas till <strong>${subscriber.email}</strong>.</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`<h1>Något gick fel</h1><p>${error instanceof Error ? error.message : "Okänt fel"}</p>`);
  }
});

app.post("/api/commute", async (req, res) => {
  try {
    const origin = String(req.body?.origin ?? "").trim();
    const destination = String(req.body?.destination ?? "").trim();
    const departureAt = String(req.body?.departureAt ?? "").trim();

    if (!origin || !destination) {
      res.status(400).json({ error: "Både start och destination behövs." });
      return;
    }

    const payload = await fetchGoogleCommuteResults({
      origin,
      destination,
      departureAt,
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      results: buildFallbackCommuteResults(
        String(req.body?.origin ?? ""),
        String(req.body?.destination ?? "")
      ),
      message: error instanceof Error ? error.message : "Kunde inte räkna restider just nu.",
    });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

await loadSubscriptions();
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
