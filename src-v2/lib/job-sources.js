import * as cheerio from "cheerio";

import {
  buildDuplicateHintKey,
  buildHistoryKey,
  buildJobId,
  categoryRank,
  classifyJob,
  cleanUrl,
  createHistoryEntry,
  extractDate,
  extractLocation,
  isIgnoredHref,
  isNoiseTitle,
  matchesStockholm,
  normalizeWhitespace,
  summarizeTitle,
} from "./job-utils.js";

export const refreshIntervalMs = 6 * 60 * 60 * 1000;

const requestTimeoutMs = 25000;

const sources = [
  {
    id: "lakartidningen",
    name: "Läkartidningen / Läkarkarriär",
    url: "https://lakarkarriar.se/",
    allowHref: ["http"],
    blockHref: [
      "lakarkarriar.se/annonsera",
      "lakarkarriar.se/arbetsplatsprofiler",
      "lakarkarriar.se/om-lakarkarriar",
      "lakarkarriar.se/ovriga-annonser",
      "lakartidningen.se/",
    ],
    requireContext: ["Ansök senast", "Sverige,", "Övriga Norden"],
  },
  {
    id: "capio",
    name: "Capio",
    url: "https://jobba.capio.se/departments/lakare",
    allowHref: ["/jobs/"],
    blockHref: ["/people", "/departments/", "/locations"],
  },
  {
    id: "meliva",
    name: "Meliva",
    url: "https://meliva.weselect.com/",
    allowHref: ["/p/"],
  },
  {
    id: "kry",
    name: "Kry",
    url: "https://career.kry.se/jobs",
    allowHref: ["/jobs/"],
  },
  {
    id: "praktikertjanst",
    name: "Praktikertjänst",
    url: "https://www.praktikertjanst.se/mer/karriar/lediga-tjanster/",
    allowHref: ["/mer/karriar/lediga-tjanster/"],
    requireContext: ["Publicerad", "Sista ansökningsdag"],
  },
  {
    id: "region-stockholm",
    name: "Region Stockholm",
    url: "https://www.regionstockholm.se/jobb/lediga-jobb/",
    allowHref: ["/jobb/lediga-jobb/"],
    requireContext: ["Ansök", "Publicerad", "Sista ansökningsdag"],
  },
  {
    id: "slso",
    name: "Stockholms läns sjukvårdsområde",
    url: "https://prod18.slso.regionstockholm.se/jobba-hos-oss/lediga-jobb/",
    allowHref: ["/jobb/lediga-jobb/", "/jobba-hos-oss/lediga-jobb/"],
    blockHref: ["/kompetensutveckling", "/mote", "/formaner"],
    requireContext: ["Sista ansökningsdag", "Heltid", "Deltid", "Publicerad"],
  },
  {
    id: "sodersjukhuset",
    name: "Södersjukhuset",
    url: "https://www.sodersjukhuset.se/jobba-pa-sos/lediga-jobb/",
    allowHref: ["/jobb/lediga-jobb/", "/jobba-pa-sos/lediga-jobb/"],
    requireContext: ["Ansök senast", "Publicerad", "Taggar"],
  },
  {
    id: "arbetsformedlingen",
    name: "Arbetsförmedlingen",
    url: "https://arbetsformedlingen.se/platsbanken/annonser?q=l%C3%A4kare",
    allowHref: ["/platsbanken/annonser/"],
  },
  {
    id: "internetmedicin",
    name: "Internetmedicin Jobb",
    url: "https://jobb.internetmedicin.se/",
    allowHref: ["/jobb/"],
    requireContext: ["Publicerad", "Sista ansök", "Sista ansökningsdag"],
  },
  {
    id: "vakanser",
    name: "Vakanser.se",
    url: "https://vakanser.se/jobb/lakare/",
    allowHref: ["/jobb/"],
  },
  {
    id: "varbi",
    name: "Varbi",
    url: "https://regionstockholm.varbi.com/se/",
    allowHref: ["jobID:"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com/jobs/doctor-jobs-stockholm",
    allowHref: ["/jobs/view/"],
    blockHref: ["/company/"],
  },
];

async function fetchHtml(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function absolutize(sourceUrl, href = "") {
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return null;
  }
}

function pickContextContainer($anchor) {
  const selectors = [
    "article",
    "li",
    "tr",
    ".job",
    ".jobs-item",
    ".job-item",
    ".opening",
    ".vacancy",
    ".listing",
    ".position",
    ".teaser",
    ".card",
    "section",
    "div",
  ];

  for (const selector of selectors) {
    const candidate = $anchor.closest(selector);
    if (!candidate.length) {
      continue;
    }

    const text = normalizeWhitespace(candidate.text());
    if (text.length >= 12 && text.length <= 1600) {
      return candidate.first();
    }
  }

  return $anchor.parent();
}

function pickTitle(parts) {
  const cleaned = parts
    .map((value) => summarizeTitle(value))
    .filter(Boolean)
    .filter((value) => !isNoiseTitle(value));

  const medicallyRelevant = cleaned
    .filter((value) => classifyJob(value, value))
    .sort((left, right) => left.length - right.length);

  if (medicallyRelevant.length) {
    return medicallyRelevant[0];
  }

  const ordered = cleaned.sort((left, right) => left.length - right.length);
  return ordered[0] ?? null;
}

function hrefMatchesRules(href, source) {
  const normalized = href.toLowerCase();

  if (source.allowHref?.length) {
    const allowHit = source.allowHref.some((fragment) => normalized.includes(fragment.toLowerCase()));
    if (!allowHit) {
      return false;
    }
  }

  if (source.blockHref?.length) {
    const blocked = source.blockHref.some((fragment) => normalized.includes(fragment.toLowerCase()));
    if (blocked) {
      return false;
    }
  }

  return true;
}

function contextMatchesRules(combined, source) {
  if (!source.requireContext?.length) {
    return true;
  }

  return source.requireContext.some((fragment) => combined.includes(fragment));
}

function extractCandidates(html, source) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const candidates = [];
  const seenLinks = new Set();

  $("a[href]").each((_, element) => {
    const $anchor = $(element);
    const href = absolutize(source.url, $anchor.attr("href"));

    if (!href || isIgnoredHref(href) || !hrefMatchesRules(href, source)) {
      return;
    }

    const cleanedHref = cleanUrl(href);
    if (seenLinks.has(cleanedHref)) {
      return;
    }

    const $container = pickContextContainer($anchor);
    const textParts = [
      $anchor.attr("aria-label"),
      $anchor.attr("title"),
      $anchor.find("h1,h2,h3,h4").first().text(),
      $anchor.text(),
      $container.find("h1,h2,h3,h4").first().text(),
      $container.text(),
    ]
      .map((value) => normalizeWhitespace(value ?? ""))
      .filter(Boolean);

    const combined = textParts.join(" | ");
    const title = pickTitle(textParts);
    const category = classifyJob(title ?? "", combined);

    if (!title || !category || !contextMatchesRules(combined, source)) {
      return;
    }

    if (/sjukskoterska|psykolog|arbetsterapeut|fysioterapeut|underskoterska/i.test(title)) {
      return;
    }

    seenLinks.add(cleanedHref);

    candidates.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      title,
      category,
      location: extractLocation(combined),
      publishedAt: extractDate(combined),
      link: cleanedHref,
      stockholmMatch: matchesStockholm(combined),
      rawContext: combined,
    });
  });

  return candidates;
}

function dedupeWithinRefresh(jobs) {
  const unique = new Map();

  for (const job of jobs) {
    const key = `${job.sourceId}|${cleanUrl(job.link)}|${job.title}|${job.location}`;
    if (!unique.has(key)) {
      unique.set(key, job);
    }
  }

  return Array.from(unique.values());
}

function enrichJobs(jobs, previousHistory = {}) {
  const now = new Date().toISOString();
  const history = { ...previousHistory };
  const duplicateMap = new Map();
  const groupedHistoryContext = new Map();

  for (const job of jobs) {
    const duplicateHintKey = buildDuplicateHintKey(job);
    if (!duplicateMap.has(duplicateHintKey)) {
      duplicateMap.set(duplicateHintKey, []);
    }
    duplicateMap.get(duplicateHintKey).push(job);

    const historyKey = buildHistoryKey(job);
    if (!groupedHistoryContext.has(historyKey)) {
      groupedHistoryContext.set(historyKey, []);
    }
    groupedHistoryContext.get(historyKey).push(job);
  }

  for (const [historyKey, group] of groupedHistoryContext.entries()) {
    const referenceJob = group[0];
    const previousEntry = previousHistory[historyKey];
    const sourceNames = Array.from(new Set(group.map((item) => item.sourceName)));

    history[historyKey] = createHistoryEntry(referenceJob, now, previousEntry, sourceNames);
  }

  const enrichedJobs = jobs.map((job) => {
    const historyKey = buildHistoryKey(job);
    const duplicateHintKey = buildDuplicateHintKey(job);
    const group = duplicateMap.get(duplicateHintKey) ?? [job];
    const previousEntry = previousHistory[historyKey];

    return {
      ...job,
      id: buildJobId(job),
      historyKey,
      duplicateHintKey,
      isDuplicate: group.length > 1,
      duplicateSources: Array.from(
        new Set(group.map((item) => item.sourceName).filter((name) => name !== job.sourceName))
      ),
      seenBefore: Boolean(previousEntry),
      firstSeenAt: history[historyKey].firstSeenAt,
      firstSeenSource: history[historyKey].firstSource,
      timesSeenAcrossRefreshes: history[historyKey].timesSeenAcrossRefreshes,
      detectedAt: now,
      searchTemplate: job.stockholmMatch ? "stockholm" : "hela-sverige",
    };
  });

  enrichedJobs.sort((left, right) => {
    const categoryDifference = categoryRank(left.category) - categoryRank(right.category);
    if (categoryDifference !== 0) {
      return categoryDifference;
    }

    if (left.stockholmMatch !== right.stockholmMatch) {
      return left.stockholmMatch ? -1 : 1;
    }

    return left.title.localeCompare(right.title, "sv");
  });

  return { jobs: enrichedJobs, history };
}

function buildStats(jobs, sourceSummaries) {
  return {
    totalJobs: jobs.length,
    stockholmJobs: jobs.filter((job) => job.stockholmMatch).length,
    sverigeJobs: jobs.filter((job) => !job.stockholmMatch).length,
    duplicateJobs: jobs.filter((job) => job.isDuplicate).length,
    sourceCount: sourceSummaries.filter((source) => source.status === "ok").length,
  };
}

export async function aggregateJobs({ previousHistory = {} } = {}) {
  const sourceSummaries = [];
  const collectedJobs = [];

  for (const source of sources) {
    try {
      const html = await fetchHtml(source);
      const sourceJobs = dedupeWithinRefresh(extractCandidates(html, source));

      collectedJobs.push(...sourceJobs);
      sourceSummaries.push({
        id: source.id,
        name: source.name,
        url: source.url,
        status: "ok",
        count: sourceJobs.length,
        message: sourceJobs.length
          ? `${sourceJobs.length} relevanta läkarjobb hittades`
          : "Inga relevanta läkarjobb hittades just nu",
      });
    } catch (error) {
      sourceSummaries.push({
        id: source.id,
        name: source.name,
        url: source.url,
        status: "error",
        count: 0,
        message: error instanceof Error ? error.message : "Okänt fel",
      });
    }
  }

  const { jobs, history } = enrichJobs(dedupeWithinRefresh(collectedJobs), previousHistory);

  return {
    jobs,
    history,
    sourceSummaries,
    stats: buildStats(jobs, sourceSummaries),
    lastUpdated: new Date().toISOString(),
  };
}
