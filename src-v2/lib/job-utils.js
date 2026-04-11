import crypto from "node:crypto";

const stockholmTerms = [
  "stockholm",
  "stockholms lan",
  "stockholm county",
  "solna",
  "sundbyberg",
  "nacka",
  "huddinge",
  "sodertalje",
  "sollentuna",
  "taby",
  "vaxholm",
  "lidingo",
  "varmdo",
  "upplands vasby",
  "jarfalla",
  "haninge",
  "botkyrka",
  "danderyd",
  "karolinska",
  "sodersjukhuset",
  "st eriks ogonsjukhus",
];

const unknownLocations = new Set(["", "okand ort", "unknown", "remote", "distans"]);

const swedishMonthMap = {
  januari: "01",
  februari: "02",
  mars: "03",
  april: "04",
  maj: "05",
  juni: "06",
  juli: "07",
  augusti: "08",
  september: "09",
  oktober: "10",
  november: "11",
  december: "12",
};

export const categoryOrder = [
  "Underläkare",
  "BT-läkare",
  "Legitimerad läkare",
  "Specialist",
];

export function normalizeWhitespace(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeForCompare(value = "") {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function hashText(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function cleanUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    const disposableParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "trackingId",
      "refId",
      "position",
      "pageNum",
    ];

    disposableParams.forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function classifyJob(title = "", context = "") {
  const text = normalizeForCompare(`${title} ${context}`);

  if (
    /\bbt\b/.test(text) ||
    text.includes("bt lakare") ||
    text.includes("bt tjanst") ||
    text.includes("bt block") ||
    text.includes("bastjanstgoring") ||
    text.includes("bastjanstgoringslakare")
  ) {
    return "BT-läkare";
  }

  if (
    text.includes("underlakare") ||
    text.includes("at lakare") ||
    text.includes("lakarkandidat") ||
    text.includes("examinerad underlakare")
  ) {
    return "Underläkare";
  }

  if (
    text.includes("specialistlakare") ||
    text.includes("specialist i") ||
    text.includes("specialist inom") ||
    text.includes("overlakare") ||
    text.includes("st lakare") ||
    text.includes("allmanspecialist") ||
    text.includes("radiolog") ||
    text.includes("ortoped") ||
    text.includes("psykiater") ||
    text.includes("anestesi") ||
    text.includes("kirurg") ||
    text.includes("allmanmedicin") ||
    text.includes("specialist")
  ) {
    return "Specialist";
  }

  if (
    text.includes("leg lakare") ||
    text.includes("legitimerad lakare") ||
    text.includes("distriktslakare") ||
    /\blakare\b/.test(text)
  ) {
    return "Legitimerad läkare";
  }

  return null;
}

export function matchesStockholm(text = "") {
  const normalized = normalizeForCompare(text);
  return stockholmTerms.some((term) => normalized.includes(term));
}

export function extractDate(text = "") {
  const compact = normalizeWhitespace(text);

  const isoMatch = compact.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const swedishDate = compact.match(
    /\b(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(20\d{2})\b/i
  );
  if (swedishDate) {
    const [, day, monthName, year] = swedishDate;
    const month = swedishMonthMap[monthName.toLowerCase()];
    return `${year}-${month}-${String(day).padStart(2, "0")}`;
  }

  const relative = compact.match(
    /(publicerad for\s+[^|]+|\d+\s+(?:dag|dagar|vecka|veckor|manad|manader|ar)\s+sedan|be an early applicant|actively hiring)/i
  );
  if (relative) {
    return normalizeWhitespace(relative[0]);
  }

  return null;
}

export function extractLocation(text = "") {
  const compact = normalizeWhitespace(text);

  const labeledMatch = compact.match(
    /(?:Ort|Plats|Placering|Var ligger arbetsplatsen\?|Location)\s*[:|]?\s*([A-ZÅÄÖa-zåäö0-9,/\- ]{2,80})/i
  );
  if (labeledMatch) {
    return normalizeWhitespace(labeledMatch[1]);
  }

  const swedenMatch = compact.match(
    /\b([A-ZÅÄÖ][A-Za-zÅÄÖåäö\- ]{1,40},\s*(?:Stockholm County,\s*)?(?:Sweden|Sverige))\b/
  );
  if (swedenMatch) {
    return normalizeWhitespace(swedenMatch[1]);
  }

  const boardMatch = compact.match(
    /\|\s*([A-ZÅÄÖ][A-Za-zÅÄÖåäö\- ]{1,40}?)\s+(?:Lediga tjänster|Publicerad|Ansök|Sista ansökningsdag|Heltid|Deltid)\b/
  );
  if (boardMatch) {
    return normalizeWhitespace(boardMatch[1]);
  }

  const cityOnly = compact.match(
    /\b(Stockholm|Solna|Sundbyberg|Nacka|Huddinge|Södertälje|Sollentuna|Täby|Uppsala|Malmö|Göteborg|Varberg|Halmstad|Enköping|Lysekil|Vällingby|Haninge|Farsta|Sigtuna|Vaxholm|Danderyd|Skövde|Skåne|Östergötland|Västra Götaland|Sverige)\b/
  );
  if (cityOnly) {
    return cityOnly[1];
  }

  if (/sodersjukhuset|sos|stockholms centrum|karolinska|danderyd/i.test(normalizeForCompare(compact))) {
    return "Stockholm";
  }

  return "Okänd ort";
}

export function normalizeLocationForCompare(location = "") {
  const normalized = normalizeForCompare(location);
  return unknownLocations.has(normalized) ? "" : normalized;
}

export function buildJobId({ sourceId, title, location, link }) {
  return `${sourceId}-${hashText(
    [normalizeForCompare(title), normalizeLocationForCompare(location), cleanUrl(link)].join("|")
  )}`;
}

export function buildHistoryKey({ title, category, location }) {
  return [
    normalizeForCompare(title),
    normalizeForCompare(category),
    normalizeLocationForCompare(location),
  ]
    .filter(Boolean)
    .join("|");
}

export function buildDuplicateHintKey({ title, category }) {
  return [normalizeForCompare(title), normalizeForCompare(category)].join("|");
}

export function categoryRank(category) {
  const index = categoryOrder.indexOf(category);
  return index === -1 ? 99 : index;
}

export function summarizeTitle(title = "") {
  return normalizeWhitespace(title)
    .replace(/\(extern länk\)/gi, "")
    .replace(/\s+[|·].*$/u, "")
    .replace(/\b(Healthcare Professionals|Vårdpersonal|Lediga jobb|Ansök)\b/gi, "")
    .replace(/\s+-\s+Läkare$/i, "")
    .replace(/\s+Läkare$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isIgnoredHref(href = "") {
  const blocked = [
    "#",
    "mailto:",
    "tel:",
    "/privacy",
    "/cookies",
    "/cookie",
    "/login",
    "/signin",
    "/connect",
    "/about",
    "/om-oss",
    "/press",
    "/kontakt",
    "/job-alert",
  ];

  return blocked.some((fragment) => href.toLowerCase().includes(fragment));
}

export function isNoiseTitle(title = "") {
  if (!title) {
    return true;
  }

  const normalized = normalizeForCompare(title);
  const noiseTerms = [
    "lediga jobb",
    "alla jobb",
    "om oss",
    "jobba hos oss",
    "sok",
    "sortera",
    "prenumerera",
    "connect",
    "skapa job alert",
    "visa fler",
    "utvalda jobb",
    "bt programmet",
    "kompetensutveckling",
  ];

  return noiseTerms.includes(normalized) || normalized.length < 6;
}

export function createHistoryEntry(job, currentTimestamp, previous, sourceNames = [job.sourceName]) {
  const base =
    previous ??
    {
      firstSeenAt: currentTimestamp,
      firstSource: job.sourceName,
      sources: [],
      timesSeenAcrossRefreshes: 0,
    };

  const uniqueSources = new Set([...(base.sources ?? []), ...sourceNames]);

  return {
    ...base,
    lastSeenAt: currentTimestamp,
    latestTitle: job.title,
    latestLocation: job.location,
    sources: Array.from(uniqueSources),
    timesSeenAcrossRefreshes: (base.timesSeenAcrossRefreshes ?? 0) + 1,
  };
}
