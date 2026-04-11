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

function normalizeProfileId(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeIntervalSettings(settings = {}) {
  const rawFrequencyHours = Number(settings.frequencyHours ?? 6);
  const explicitUnit = settings.intervalUnit === "days" ? "days" : settings.intervalUnit === "hours" ? "hours" : "";

  let intervalUnit = explicitUnit;
  let intervalValue = Number(settings.intervalValue);

  if (!Number.isFinite(intervalValue) || intervalValue <= 0) {
    if (!intervalUnit) {
      intervalUnit = rawFrequencyHours >= 24 && rawFrequencyHours % 24 === 0 ? "days" : "hours";
    }

    intervalValue =
      intervalUnit === "days"
        ? Math.max(1, Math.round(rawFrequencyHours / 24 || 1))
        : Math.max(1, Math.round(rawFrequencyHours || 6));
  }

  if (!intervalUnit) {
    intervalUnit = rawFrequencyHours >= 24 && rawFrequencyHours % 24 === 0 ? "days" : "hours";
  }

  const maximum = intervalUnit === "days" ? 90 : 720;
  intervalValue = Math.min(maximum, Math.max(1, Math.round(intervalValue)));

  return {
    intervalUnit,
    intervalValue,
    frequencyHours: intervalUnit === "days" ? intervalValue * 24 : intervalValue,
  };
}

function createNotificationSettings(settings = {}) {
  const interval = normalizeIntervalSettings(settings);
  const templates = Array.isArray(settings.templates)
    ? settings.templates.slice(0, 8)
    : [];
  const categories = Array.isArray(settings.categories)
    ? settings.categories.slice(0, 12)
    : ["UnderlĂ¤kare", "BT-lĂ¤kare", "ST-lĂ¤kare", "Legitimerad lĂ¤kare", "Specialist"];
  return {
    enabled: Boolean(settings.enabled),
    intervalUnit: interval.intervalUnit,
    intervalValue: interval.intervalValue,
    frequencyHours: interval.frequencyHours,
    templates: templates.length ? templates : ["stockholm", "uppsala", "hela-sverige"],
    categories: categories.length
      ? categories
      : ["UnderlĂ¤kare", "BT-lĂ¤kare", "ST-lĂ¤kare", "Legitimerad lĂ¤kare", "Specialist"],
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
      durationText: "BerĂ¤knas i Google Maps",
      distanceText: "Ă–ppna lĂ¤nk fĂ¶r exakt restid",
      note: "Google Maps Ă¶ppnas med biltrafik och aktuell vardagstrafik fĂ¶r den valda tiden.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "driving" }),
      visualWidth: 34,
    },
    {
      id: "bus",
      label: "Buss",
      pill: "Kollektivt",
      durationText: "BerĂ¤knas i Google Maps",
      distanceText: "Ă–ppna lĂ¤nk fĂ¶r exakt restid",
      note: "Google Maps Ă¶ppnas i kollektivtrafiklĂ¤ge. Buss och byten rĂ¤knas dĂ¤r.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "bus" }),
      visualWidth: 34,
    },
    {
      id: "rail",
      label: "TĂĄg",
      pill: "Kollektivt",
      durationText: "BerĂ¤knas i Google Maps",
      distanceText: "Ă–ppna lĂ¤nk fĂ¶r exakt restid",
      note: "Google Maps Ă¶ppnas i kollektivtrafiklĂ¤ge. TĂĄg och byten rĂ¤knas dĂ¤r.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "rail" }),
      visualWidth: 34,
    },
    {
      id: "bicycling",
      label: "Cykel",
      pill: "Cykel",
      durationText: "BerĂ¤knas i Google Maps",
      distanceText: "Ă–ppna lĂ¤nk fĂ¶r exakt restid",
      note: "Google Maps Ă¶ppnas i cykellĂ¤ge sĂĄ att du snabbt kan jĂ¤mfĂ¶ra med andra alternativ.",
      link: buildGoogleMapsLink({ origin, destination, modeId: "bicycling" }),
      visualWidth: 34,
    },
  ];
}

async function loadSubscriptions() {
  await ensureDataDirectory();

  try {
    const stored = JSON.parse(await fs.readFile(subscribersFile, "utf8"));
    subscriptionState.subscribers = Array.isArray(stored.subscribers)
      ? stored.subscribers
          .map((subscriber) => normalizeSubscriber(subscriber))
          .filter((subscriber) => looksLikeEmail(subscriber.email))
      : [];
    subscriptionState.updatedAt = stored.updatedAt ?? null;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Kunde inte lĂ¤sa lokal prenumerationsfil:", error);
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

function normalizeSubscriber(entry = {}) {
  const normalizedEmail = normalizeEmail(entry.email);
  const profileId = normalizeProfileId(entry.profileId || normalizedEmail);
  const now = new Date().toISOString();

  return {
    email: normalizedEmail,
    profileId,
    profileName: String(entry.profileName || profileId || normalizedEmail || "profil").trim(),
    notifications: createNotificationSettings(entry.notifications),
    unsubscribeToken: entry.unsubscribeToken || buildUnsubscribeToken(),
    createdAt: entry.createdAt ?? now,
    updatedAt: entry.updatedAt ?? now,
    confirmedAt: entry.confirmedAt ?? null,
    lastCheckedAt: entry.lastCheckedAt ?? null,
    lastEmailedAt: entry.lastEmailedAt ?? null,
    lastTestedAt: entry.lastTestedAt ?? null,
    unsubscribedAt: entry.unsubscribedAt ?? null,
  };
}

function findSubscriptionIndex({ profileId = "", email = "" } = {}) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const normalizedEmail = normalizeEmail(email);

  if (normalizedProfileId) {
    const byProfile = subscriptionState.subscribers.findIndex(
      (subscriber) => subscriber.profileId === normalizedProfileId
    );
    if (byProfile >= 0) {
      return byProfile;
    }
  }

  if (normalizedEmail) {
    return subscriptionState.subscribers.findIndex(
      (subscriber) => normalizeEmail(subscriber.email) === normalizedEmail
    );
  }

  return -1;
}

function findSubscription(criteria = {}) {
  const index = findSubscriptionIndex(criteria);
  return index >= 0 ? subscriptionState.subscribers[index] : null;
}

function upsertSubscription({ email, notifications, profileId = "", profileName = "" }) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  const normalizedProfileId = normalizeProfileId(profileId || normalizedEmail);
  const existingIndex = findSubscriptionIndex({
    profileId: normalizedProfileId,
    email: normalizedEmail,
  });
  const notificationSettings = createNotificationSettings(notifications);

  if (existingIndex >= 0) {
    subscriptionState.subscribers[existingIndex] = normalizeSubscriber({
      ...subscriptionState.subscribers[existingIndex],
      email: normalizedEmail,
      profileId: normalizedProfileId,
      profileName: profileName || subscriptionState.subscribers[existingIndex].profileName || normalizedProfileId,
      notifications: notificationSettings,
      confirmedAt: subscriptionState.subscribers[existingIndex].confirmedAt ?? now,
      updatedAt: now,
      unsubscribedAt: notificationSettings.enabled ? null : subscriptionState.subscribers[existingIndex].unsubscribedAt,
    });

    return subscriptionState.subscribers[existingIndex];
  }

  const subscriber = normalizeSubscriber({
    email: normalizedEmail,
    profileId: normalizedProfileId,
    profileName: profileName || normalizedProfileId || normalizedEmail,
    notifications: notificationSettings,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
  });

  subscriptionState.subscribers.push(subscriber);
  return subscriber;
}

function removeSubscription({ profileId = "", email = "" } = {}) {
  const index = findSubscriptionIndex({ profileId, email });
  if (index < 0) {
    return null;
  }

  const [removed] = subscriptionState.subscribers.splice(index, 1);
  return removed ?? null;
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
      console.error("Kunde inte lĂ¤sa cachefil:", error);
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
        "Google Maps-nyckel saknas pĂĄ servern. DĂ¤rfĂ¶r visas fĂ¤rdiga lĂ¤nkar men inte exakta restider Ă¤nnu.",
    };
  }

  const departureTime = Math.floor((toDate(departureAt) ?? new Date()).getTime() / 1000);
  const definitions = [
    { id: "driving", label: "Bil", pill: "Bil", mode: "driving" },
    { id: "bus", label: "Buss", pill: "Kollektivt", mode: "transit", transitMode: "bus" },
    { id: "rail", label: "TĂĄg", pill: "Kollektivt", mode: "transit", transitMode: "rail" },
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
          note: "Google Maps kunde inte hitta en tydlig rutt fĂ¶r den hĂ¤r kombinationen Ă¤nnu.",
          link: buildGoogleMapsLink({ origin, destination, modeId: definition.id }),
          visualWidth: 20,
        };
      }

      const durationSeconds = leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0;
      const distanceText = leg.distance?.text ?? "OkĂ¤nd distans";
      const summary = payload.routes?.[0]?.summary;

      return {
        id: definition.id,
        label: definition.label,
        pill: definition.pill,
        durationText: formatDuration(durationSeconds),
        distanceText,
        note: summary
          ? `Google Maps fĂ¶reslĂĄr rutten via ${summary}.`
          : "BerĂ¤knat utifrĂĄn vald avresetid och aktuell ruttlogik i Google Maps.",
        link: buildGoogleMapsLink({ origin, destination, modeId: definition.id }),
        visualWidth: estimateVisualWidth(durationSeconds),
      };
    })
  );

  return {
    results,
    message: "Restider hĂ¤mtade frĂĄn Google Maps och klara att jĂ¤mfĂ¶ra.",
  };
}

function matchesTemplatePreference(job, templates = []) {
  if (!templates.length) {
    return true;
  }

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
              ${job.category} Â· ${job.roleLabel ?? "LĂ¤kare"} Â· ${job.employer || "Arbetsgivare ej angiven"}
            </span>
            <span style="display:block;margin-top:4px;color:#45606c;font-size:13px;">
              ${job.location || "OkĂ¤nd ort"} Â· ${job.sourceNames?.join(", ") || job.sourceName || "OkĂ¤nd kĂ¤lla"}
            </span>
            <p style="margin:10px 0 0;color:#2d4754;font-size:14px;line-height:1.6;">
              ${job.roleSummary || "Ny matchande annons upptĂ¤ckt."}
            </p>
            <a href="${job.link}" style="display:inline-block;margin-top:12px;color:#0f7c8c;text-decoration:none;font-weight:700;">
              Ă–ppna annons
            </a>
          </div>
        </li>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f4f8fb;padding:24px;color:#10212b;">
      <div style="max-width:760px;margin:0 auto;">
        <h1 style="margin:0 0 8px;font-size:28px;">Nya lĂ¤karjobb matchar ditt konto</h1>
        <p style="margin:0 0 18px;line-height:1.6;color:#45606c;">
          Hej. HĂ¤r Ă¤r ${jobsForSubscriber.length} nya annons${jobsForSubscriber.length === 1 ? "" : "er"} som matchar dina val fĂ¶r ${subscriber.email}.
        </p>
        <ul style="margin:0;padding:0;">${items}</ul>
        ${
          unsubscribeLink
            ? `<p style="margin-top:18px;color:#45606c;font-size:13px;line-height:1.6;">
                 Vill du inte ha fler notiser? <a href="${unsubscribeLink}" style="color:#0f7c8c;">Avregistrera dig hĂ¤r</a>.
               </p>`
            : ""
        }
      </div>
    </div>
  `;
}

function buildSubscriptionWelcomeEmailHtml(subscriber, baseUrl) {
  const unsubscribeLink = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/unsubscribe?token=${subscriber.unsubscribeToken}`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;background:#f4f8fb;padding:24px;color:#10212b;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #d8e6ee;border-radius:20px;padding:24px;">
        <h1 style="margin:0 0 10px;font-size:28px;">Din prenumeration Ă¤r nu kopplad</h1>
        <p style="margin:0 0 14px;line-height:1.7;color:#45606c;">
          Profilen <strong>${subscriber.profileName}</strong> skickar nu jobbnotiser till <strong>${subscriber.email}</strong>.
        </p>
        <p style="margin:0 0 14px;line-height:1.7;color:#45606c;">
          Intervall: var ${subscriber.notifications.intervalValue} ${subscriber.notifications.intervalUnit === "days" ? "dag" : "timme"}${subscriber.notifications.intervalValue === 1 ? "" : "r"}.
        </p>
        <p style="margin:0 0 14px;line-height:1.7;color:#45606c;">
          OmrĂĄden: ${subscriber.notifications.templates.length ? subscriber.notifications.templates.join(", ") : "alla"}.
          Roller: ${subscriber.notifications.categories.length ? subscriber.notifications.categories.join(", ") : "alla"}.
        </p>
        ${
          unsubscribeLink
            ? `<p style="margin:18px 0 0;color:#45606c;font-size:13px;line-height:1.6;">
                 Vill du koppla bort notiserna? <a href="${unsubscribeLink}" style="color:#0f7c8c;">Avregistrera dig hĂ¤r</a>.
               </p>`
            : ""
        }
      </div>
    </div>
  `;
}

function buildSubscriptionTestEmailHtml(subscriber, baseUrl) {
  const unsubscribeLink = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/unsubscribe?token=${subscriber.unsubscribeToken}`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;background:#f4f8fb;padding:24px;color:#10212b;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #d8e6ee;border-radius:20px;padding:24px;">
        <h1 style="margin:0 0 10px;font-size:28px;">Testmail frĂĄn LĂ¤karjobb Radar</h1>
        <p style="margin:0 0 14px;line-height:1.7;color:#45606c;">
          Det hĂ¤r mailet bekrĂ¤ftar att prenumerationen fĂ¶r <strong>${subscriber.profileName}</strong> kan nĂĄ <strong>${subscriber.email}</strong>.
        </p>
        <p style="margin:0 0 14px;line-height:1.7;color:#45606c;">
          NĂ¤sta riktiga utskick kommer nĂ¤r nya annonser matchar dina val.
        </p>
        ${
          unsubscribeLink
            ? `<p style="margin:18px 0 0;color:#45606c;font-size:13px;line-height:1.6;">
                 Vill du koppla bort notiserna? <a href="${unsubscribeLink}" style="color:#0f7c8c;">Avregistrera dig hĂ¤r</a>.
               </p>`
            : ""
        }
      </div>
    </div>
  `;
}

async function sendEmailMessage({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM;

  if (!apiKey || !fromAddress) {
    return { sent: false, reason: "not-configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      subject,
      html,
    }),
  });

  return {
    sent: response.ok,
    reason: response.ok ? "ok" : `http-${response.status}`,
  };
}

async function sendSubscriptionWelcomeEmail(subscriber) {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
  const result = await sendEmailMessage({
    to: subscriber.email,
    subject: `Prenumerationen ar kopplad for ${subscriber.profileName}`,
    html: buildSubscriptionWelcomeEmailHtml(subscriber, baseUrl),
  });

  if (result.sent) {
    const now = new Date().toISOString();
    subscriber.confirmedAt = now;
    subscriber.updatedAt = now;
  }

  return result;
}

async function sendSubscriptionTestEmail(subscriber) {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
  const result = await sendEmailMessage({
    to: subscriber.email,
    subject: `Testmail fran Lakarjobb Radar for ${subscriber.profileName}`,
    html: buildSubscriptionTestEmailHtml(subscriber, baseUrl),
  });

  if (result.sent) {
    const now = new Date().toISOString();
    subscriber.lastTestedAt = now;
    subscriber.updatedAt = now;
  }

  return result;
}

async function sendEmailNotifications(jobs = []) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !subscriptionState.subscribers.length) {
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

      const selectedCategories = subscriber.notifications.categories ?? [];
      return selectedCategories.length === 0 || selectedCategories.includes(job.category);
    });

    subscriber.lastCheckedAt = now.toISOString();

    if (!relevantJobs.length) {
      continue;
    }

    const response = await sendEmailMessage({
      to: subscriber.email,
      subject: `${relevantJobs.length} nya lakarjobb matchar dina filter`,
      html: buildNotificationEmailHtml(subscriber, relevantJobs, baseUrl),
    });

    if (response.sent) {
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
      `[refresh:${reason}] ${state.jobs.length} jobb hĂ¤mtade frĂĄn ${state.sourceSummaries.length} kĂ¤llor`
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
      error: error instanceof Error ? error.message : "OkĂ¤nt fel",
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
      error: error instanceof Error ? error.message : "OkĂ¤nt fel",
    });
  }
});

app.get("/api/status", (_req, res) => {
  res.json(payload());
});

app.get("/api/subscriptions", (req, res) => {
  const subscription = findSubscription({
    profileId: String(req.query.profileId ?? ""),
    email: String(req.query.email ?? ""),
  });

  res.json({ subscription });
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
      profileId: String(req.body?.profileId ?? ""),
      profileName: String(req.body?.profileName ?? ""),
      notifications: req.body?.notifications ?? {},
    });
    await persistSubscriptions();

    const welcomeRequested = req.body?.sendWelcome !== false;
    let welcomeResult = { sent: false, reason: "skipped" };
    if (welcomeRequested) {
      welcomeResult = await sendSubscriptionWelcomeEmail(subscription);
      await persistSubscriptions();
    }

    const message = welcomeResult.sent
      ? `E-postnotiser ar sparade for ${subscription.email}. Ett bekraftelsemail har skickats.`
      : `E-postnotiser ar sparade for ${subscription.email}.`;

    res.json({
      message,
      subscription,
      welcomeSent: welcomeResult.sent,
      welcomeReason: welcomeResult.reason,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Okant fel",
    });
  }
});

app.post("/api/subscriptions/test", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!looksLikeEmail(email)) {
      res.status(400).json({ error: "Ogiltig e-postadress" });
      return;
    }

    const subscription = upsertSubscription({
      email,
      profileId: String(req.body?.profileId ?? ""),
      profileName: String(req.body?.profileName ?? ""),
      notifications: req.body?.notifications ?? {},
    });
    await persistSubscriptions();

    const testResult = await sendSubscriptionTestEmail(subscription);
    if (!testResult.sent) {
      res.status(503).json({
        error: "Mailtjansten ar inte konfigurerad just nu.",
        reason: testResult.reason,
      });
      return;
    }

    await persistSubscriptions();
    res.json({
      message: `Testmail skickat till ${subscription.email}.`,
      sentAt: subscription.lastTestedAt,
      subscription,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Okant fel",
    });
  }
});

app.delete("/api/subscriptions", async (req, res) => {
  try {
    const removed = removeSubscription({
      profileId: String(req.body?.profileId ?? ""),
      email: String(req.body?.email ?? ""),
    });

    if (!removed) {
      res.status(404).json({ error: "Prenumerationen kunde inte hittas." });
      return;
    }

    await persistSubscriptions();
    res.json({
      message: `E-postprenumerationen for ${removed.email} ar bortkopplad.`,
      removed,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Okant fel",
    });
  }
});
app.get("/unsubscribe", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) {
      res.status(400).send("<h1>Ogiltig avregistreringslĂ¤nk</h1>");
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
          <h1>Du Ă¤r nu avregistrerad</h1>
          <p>Inga fler jobbnotiser skickas till <strong>${subscriber.email}</strong>.</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`<h1>NĂĄgot gick fel</h1><p>${error instanceof Error ? error.message : "OkĂ¤nt fel"}</p>`);
  }
});

app.post("/api/commute", async (req, res) => {
  try {
    const origin = String(req.body?.origin ?? "").trim();
    const destination = String(req.body?.destination ?? "").trim();
    const departureAt = String(req.body?.departureAt ?? "").trim();

    if (!origin || !destination) {
      res.status(400).json({ error: "BĂĄde start och destination behĂ¶vs." });
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
      message: error instanceof Error ? error.message : "Kunde inte rĂ¤kna restider just nu.",
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
    console.error("FĂ¶rsta uppdateringen misslyckades:", error);
  }
}

setInterval(() => {
  refreshJobs({ reason: "schedule" }).catch((error) => {
    console.error("Schemalagd uppdatering misslyckades:", error);
  });
}, refreshIntervalMs);

state.nextScheduledRefreshAt ||= buildNextRefreshTimestamp();

app.listen(port, () => {
  console.log(`LĂ¤karjobb-servern kĂ¶r pĂĄ http://localhost:${port}`);
});

