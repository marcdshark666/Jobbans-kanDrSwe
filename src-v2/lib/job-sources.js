import * as cheerio from "cheerio";

import {
  buildRoleSummary,
  buildDuplicateHintKey,
  buildHistoryKey,
  buildJobId,
  categoryRank,
  classifyJob,
  cleanUrl,
  containsExcludedNonDoctorRole,
  createHistoryEntry,
  extractDate,
  extractContactEntries,
  extractEmployer,
  extractLocation,
  extractStartInfo,
  hasExpiredDeadlineNotice,
  inferRoleLabel,
  isIgnoredHref,
  isNoiseTitle,
  matchesStockholm,
  matchesUppsala,
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
  {
    id: "ledigajobb",
    name: "Ledigajobb.se",
    url: "https://ledigajobb.se/pr/l%C3%A4kare",
    allowHref: ["https://ledigajobb.se/jobb/"],
  },
  {
    id: "region-uppsala",
    name: "Region Uppsala",
    url: "https://regionuppsala.se/jobba-hos-oss/lediga-tjanster/?occupationGroup=0&query=l%C3%A4kare&sortBy=enddate&summerJob=false",
    allowHref: ["/jobba-hos-oss/lediga-tjanster/"],
    requireContext: ["Lediga jobb i Region Uppsala", "ST-läkare", "Specialistläkare"],
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

function extractDocumentText(html = "") {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return normalizeWhitespace($("body").text());
}

function extractRelatedContactLinks(html = "", currentUrl = "") {
  const $ = cheerio.load(html);
  const current = new URL(currentUrl);
  const results = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    const href = absolutize(currentUrl, $(element).attr("href"));
    if (!href || seen.has(href)) {
      return;
    }

    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      return;
    }

    if (parsed.origin !== current.origin) {
      return;
    }

    const label = normalizeWhitespace($(element).text());
    const combined = `${label} ${href}`.toLowerCase();
    if (!/(kontakt|contact|om oss|mottagning|verksamhet|medarbetare|team|klinik)/i.test(combined)) {
      return;
    }

    if (/(jobb|career|karriar|lediga-jobb|jobID:|apply|ansok)/i.test(combined)) {
      return;
    }

    seen.add(href);
    results.push(href);
  });

  return results.slice(0, 2);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichJobFromDetail(job, source) {
  let detailText = "";
  let relatedContactText = "";

  try {
    const html = await fetchHtml({ ...source, url: job.link });
    detailText = extractDocumentText(html);

    let contacts = extractContactEntries(detailText, source.name);

    if (!contacts.length) {
      const relatedLinks = extractRelatedContactLinks(html, job.link);

      for (const relatedLink of relatedLinks) {
        try {
          const relatedHtml = await fetchHtml({ ...source, url: relatedLink });
          const relatedText = extractDocumentText(relatedHtml);
          relatedContactText = `${relatedContactText} ${relatedText}`.trim();
          contacts = contacts.concat(extractContactEntries(relatedText, source.name));

          if (contacts.length >= 3) {
            break;
          }
        } catch {
          // Best effort only for fallback contact pages.
        }
      }
    }

    const combinedContext = normalizeWhitespace(
      [job.rawContext, detailText, relatedContactText].filter(Boolean).join(" | ")
    );

    if (hasExpiredDeadlineNotice(combinedContext)) {
      return null;
    }

    const upgradedCategory = classifyJob(job.title, combinedContext) ?? job.category;

    return {
      ...job,
      category: upgradedCategory,
      roleLabel: inferRoleLabel(job.title, combinedContext),
      roleSummary: buildRoleSummary(job.title, combinedContext),
      employer: extractEmployer(combinedContext, job.employer || source.name),
      startInfo: extractStartInfo(combinedContext) || job.startInfo || "",
      detailSnippet: detailText.slice(0, 320),
      contacts,
      uppsalaMatch: matchesUppsala(combinedContext),
      stockholmMatch: matchesStockholm(combinedContext),
      rawContext: combinedContext,
    };
  } catch {
    return {
      ...job,
      roleLabel: inferRoleLabel(job.title, job.rawContext),
      roleSummary: buildRoleSummary(job.title, job.rawContext),
      contacts: [],
    };
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

    if (
      containsExcludedNonDoctorRole(title) ||
      /psykolog|arbetsterapeut|fysioterapeut|tandlakare/i.test(title) ||
      hasExpiredDeadlineNotice(combined)
    ) {
      return;
    }

    seenLinks.add(cleanedHref);

    candidates.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      title,
      category,
      roleLabel: inferRoleLabel(title, combined),
      roleSummary: buildRoleSummary(title, combined),
      location: extractLocation(combined),
      employer: extractEmployer(combined, source.name),
      startInfo: extractStartInfo(combined),
      publishedAt: extractDate(combined),
      link: cleanedHref,
      stockholmMatch: matchesStockholm(combined),
      uppsalaMatch: matchesUppsala(combined),
      rawContext: combined,
      contacts: [],
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
    uppsalaJobs: jobs.filter((job) => job.uppsalaMatch).length,
    sverigeJobs: jobs.filter((job) => !job.stockholmMatch).length,
    duplicateJobs: jobs.filter((job) => job.isDuplicate).length,
    sourceCount: sourceSummaries.filter((source) => source.status === "ok").length,
  };
}

export async function aggregateJobs({ previousHistory = {} } = {}) {
  const sourceSummaries = [];
  const collectedJobs = [];
  const detailConcurrency = 4;

  for (const source of sources) {
    try {
      const html = await fetchHtml(source);
      const sourceJobs = dedupeWithinRefresh(extractCandidates(html, source));
      const enrichedSourceJobs = (
        await mapWithConcurrency(sourceJobs, detailConcurrency, (job) => enrichJobFromDetail(job, source))
      ).filter(Boolean);

      collectedJobs.push(...enrichedSourceJobs);
      sourceSummaries.push({
        id: source.id,
        name: source.name,
        url: source.url,
        status: "ok",
        count: enrichedSourceJobs.length,
        message: enrichedSourceJobs.length
          ? `${enrichedSourceJobs.length} relevanta läkarjobb hittades`
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
