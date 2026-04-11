import crypto from "node:crypto";

const stockholmTerms = [
  "stockholm",
  "stockholms lan",
  "stockholm county",
  "ekero",
  "stenhamra",
  "faringso",
  "bromma",
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

const uppsalaTerms = [
  "uppsala",
  "uppsala lan",
  "enkoping",
  "knivsta",
  "tierp",
  "osthammar",
  "alvkarleby",
  "heby",
  "habo",
  "akademiska",
  "lasarettet i enkoping",
  "region uppsala",
];

const unknownLocations = new Set(["", "okand ort", "unknown", "remote", "distans", "jobb i fokus"]);

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
  "ST-läkare",
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
  const combinedText = normalizeForCompare(`${title} ${context}`);
  if (
    containsExcludedNonDoctorRole(title) ||
    combinedText.includes("tandlakare") ||
    combinedText.includes("odontolog")
  ) {
    return null;
  }

  const titleText = normalizeForCompare(title);
  const signalText = buildRoleSignalText(title, context);

  if (matchesBtRole(titleText)) {
    return "BT-läkare";
  }

  if (matchesStRole(titleText)) {
    return "ST-läkare";
  }

  if (matchesSpecialistRole(titleText)) {
    return "Specialist";
  }

  if (matchesUnderlakareRole(titleText)) {
    return "Underläkare";
  }

  if (matchesLegitimeradRole(titleText)) {
    return "Legitimerad läkare";
  }

  if (matchesBtRole(signalText)) {
    return "BT-läkare";
  }

  if (matchesStRole(signalText)) {
    return "ST-läkare";
  }

  if (matchesSpecialistRole(signalText)) {
    return "Specialist";
  }

  if (matchesUnderlakareRole(signalText)) {
    return "Underläkare";
  }

  if (matchesLegitimeradRole(signalText)) {
    return "Legitimerad läkare";
  }

  return null;
}

export function containsExcludedNonDoctorRole(value = "") {
  return /sjukskotersk|underskotersk|skotersk|barnmorsk|omvardnad|nurse|nursing/i.test(
    normalizeForCompare(value)
  );
}

function buildRoleSignalText(title = "", context = "") {
  const compact = normalizeWhitespace(context);
  const spotlight = splitSpotlightSentences(compact)
    .filter((sentence) =>
      /(vi söker|söker dig|kvalifikation|krav|du har|vi letar|legitimerad|specialist|underläkare|bt|läkarexamen)/i.test(
        sentence
      )
    )
    .slice(0, 4)
    .join(" ");

  return normalizeForCompare(`${title} ${spotlight}`);
}

function matchesBtRole(text = "") {
  return (
    /\bbt\b/.test(text) ||
    text.includes("bt lakare") ||
    text.includes("bt tjanst") ||
    text.includes("bt block") ||
    text.includes("bastjanstgoring") ||
    text.includes("bastjanstgoringslakare")
  );
}

function matchesStRole(text = "") {
  return (
    text.includes("st lakare") ||
    text.includes("st tjanst") ||
    text.includes("specialiseringstjanstgoring") ||
    text.includes("sikte pa st") ||
    text.includes("med mojlighet till st") ||
    text.includes("blivande st")
  );
}

function matchesUnderlakareRole(text = "") {
  return (
    text.includes("underlakare") ||
    text.includes("at lakare") ||
    text.includes("lakarkandidat") ||
    text.includes("examinerad underlakare") ||
    text.includes("lakarexamen")
  );
}

function matchesSpecialistRole(text = "") {
  return (
    text.includes("spec lakare") ||
    text.includes("specialistlakare") ||
    text.includes("specialist i") ||
    text.includes("specialist inom") ||
    text.includes("overlakare") ||
    text.includes("allmanspecialist") ||
    text.includes("radiolog") ||
    text.includes("ortoped") ||
    text.includes("psykiater") ||
    text.includes("anestesi") ||
    text.includes("kirurg") ||
    text.includes("allmanmedicin") ||
    text.includes("specialist")
  );
}

function matchesLegitimeradRole(text = "") {
  return (
    text.includes("leg lakare") ||
    text.includes("legitimerad lakare") ||
    text.includes("distriktslakare") ||
    /\blakare\b/.test(text)
  );
}

export function matchesStockholm(text = "") {
  const normalized = normalizeForCompare(text);
  return stockholmTerms.some((term) => normalized.includes(term));
}

export function matchesUppsala(text = "") {
  const normalized = normalizeForCompare(text);
  return uppsalaTerms.some((term) => normalized.includes(term));
}

export function extractDate(text = "") {
  const compact = normalizeWhitespace(text);

  const isoDateTimeMatch = compact.match(/\b20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b/);
  if (isoDateTimeMatch) {
    return isoDateTimeMatch[0].replace(" ", "T");
  }

  const isoMatch = compact.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const swedishDate = compact.match(
    /\b(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(20\d{2})(?:\s+kl\.?\s*(\d{1,2})[:.](\d{2}))?\b/i
  );
  if (swedishDate) {
    const [, day, monthName, year, hour, minute] = swedishDate;
    const month = swedishMonthMap[monthName.toLowerCase()];
    const date = `${year}-${month}-${String(day).padStart(2, "0")}`;
    return hour && minute
      ? `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`
      : date;
  }

  const relative = compact.match(
    /(publicerad for\s+[^|]+|\d+\s+(?:minut|minuter|timme|timmar|dag|dagar|vecka|veckor|manad|manader|ar|month|months|hour|hours|day|days)\s+sedan|be an early applicant|actively hiring)/i
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
    const candidate = normalizeWhitespace(labeledMatch[1]);
    if (isPlausibleEmployer(candidate)) {
      return candidate;
    }
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
    /\b(Stockholm|Solna|Sundbyberg|Nacka|Huddinge|Ekerö|Stenhamra|Södertälje|Sollentuna|Täby|Uppsala|Knivsta|Tierp|Östhammar|Enköping|Malmö|Göteborg|Varberg|Halmstad|Lysekil|Vällingby|Haninge|Farsta|Sigtuna|Vaxholm|Danderyd|Skövde|Skåne|Östergötland|Västra Götaland|Sverige)\b/
  );
  if (cityOnly) {
    return cityOnly[1];
  }

  if (/sodersjukhuset|sos|stockholms centrum|karolinska|danderyd|ekero|stenhamra/i.test(normalizeForCompare(compact))) {
    return "Stockholm";
  }

  if (/akademiska|region uppsala|lasarettet i enkoping|uppsala/i.test(normalizeForCompare(compact))) {
    return "Uppsala";
  }

  return "Okänd ort";
}

export function normalizeLocationForCompare(location = "") {
  const normalized = normalizeForCompare(location);
  return unknownLocations.has(normalized) ? "" : normalized;
}

export function extractEmployer(text = "", fallback = "") {
  const compact = normalizeWhitespace(text);

  const labeledMatch = compact.match(
    /(?:Organisation|Organization|Arbetsgivare|Employer|Klinik|Verksamhet)\s*[:|]?\s*([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9&,\-./ ]{2,90})/
  );
  if (labeledMatch) {
    const candidate = sanitizeEmployerValue(labeledMatch[1]);
    if (isPlausibleEmployer(candidate)) {
      return candidate;
    }
  }

  const byTextMatch = compact.match(
    /(?:hos|på|till)\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9&,\-./ ]{2,80}?)(?:\s+(?:i|med|som|Stockholm|Uppsala|Sverige)\b|$)/
  );
  if (byTextMatch) {
    const candidate = sanitizeEmployerValue(byTextMatch[1]);
    if (isPlausibleEmployer(candidate)) {
      return candidate;
    }
  }

  const fallbackCandidate = sanitizeEmployerValue(fallback);
  return isPlausibleEmployer(fallbackCandidate) ? fallbackCandidate : "";
}

export function extractEmployerSafe(text = "", fallback = "") {
  const direct = sanitizeEmployerValue(extractEmployer(text, fallback));
  if (isPlausibleEmployer(direct)) {
    return direct;
  }

  const compact = normalizeWhitespace(text);
  const candidateMatch = compact.match(
    /(?:hos|på|till)\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9&,\-./ ]{2,80}?)(?:\s+(?:i|med|som|för)\b|$)/i
  );

  if (candidateMatch) {
    const candidate = sanitizeEmployerValue(candidateMatch[1]);
    if (isPlausibleEmployer(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function extractStartInfo(text = "") {
  const compact = normalizeWhitespace(text);
  const match = compact.match(
    /(?:Tillträde|Startdatum|Start)\s*[:|]?\s*([^|.]{3,120})/i
  );

  if (match) {
    const candidate = sanitizeStartInfo(match[1]);
    if (
      !/annonsera jobb|rekryteringssystem|vanliga fragor|jobbsokare|karriartips|integritet|familj/i.test(
        normalizeForCompare(candidate)
      )
    ) {
      return candidate;
    }
  }

  return "";
}

export function extractStartInfoSafe(text = "") {
  const compact = normalizeWhitespace(text);
  const safeMatch = compact.match(
    /(?:Tillträde)\s*[:|]?\s*([^|.]{3,120})|(?:Startdatum|Start)\s*[:]\s*([^|.]{3,120})/i
  );

  if (safeMatch) {
    const candidate = sanitizeStartInfo(safeMatch[1] || safeMatch[2] || "");
    if (isPlausibleStartInfo(candidate)) {
      return candidate;
    }
  }

  const fallback = sanitizeStartInfo(extractStartInfo(text));
  return isPlausibleStartInfo(fallback) ? fallback : "";
}

export function hasExpiredDeadlineNotice(text = "") {
  return /observera att sista ansokningsdag har passerat/i.test(normalizeForCompare(text));
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

const specialtyMatchers = [
  { label: "allmänmedicin", terms: ["allmanmedicin", "vardcentral", "huslakare", "distriktslakare"] },
  { label: "gynekologi", terms: ["gynekologi", "obstetrik", "gyn"] },
  { label: "psykiatri", terms: ["psykiatri", "psykiater"] },
  { label: "ortopedi", terms: ["ortopedi", "ortoped"] },
  { label: "radiologi", terms: ["radiologi", "radiolog"] },
  { label: "onkologi", terms: ["onkologi", "onkolog"] },
  { label: "kirurgi", terms: ["kirurgi", "kirurg", "kolorektal"] },
  { label: "anestesi och intensivvård", terms: ["anestesi", "intensivvard", "iva"] },
  { label: "barn- och ungdomsmedicin", terms: ["barnmedicin", "barn och ungdomsmedicin", "pediatr"] },
  { label: "akutsjukvård", terms: ["akutsjukvard", "akutmottagning"] },
  { label: "geriatrik", terms: ["geriatrik", "geriatr"] },
  { label: "internmedicin", terms: ["internmedicin"] },
];

function detectSpecialty(normalizedText = "") {
  const hit = specialtyMatchers.find(({ terms }) =>
    terms.some((term) => normalizedText.includes(term))
  );

  return hit?.label ?? "";
}

export function inferRoleLabel(title = "", context = "") {
  const category = classifyJob(title, context);
  const specialty = detectSpecialty(buildRoleSignalText(title, context));

  if (category === "Specialist") {
    return specialty ? `Specialistläkare inom ${specialty}` : "Specialistläkare";
  }

  if (category === "BT-läkare") {
    return "BT-läkare";
  }

  if (category === "ST-läkare") {
    return specialty ? `ST-läkare inom ${specialty}` : "ST-läkare";
  }

  if (category === "Underläkare") {
    return "Underläkare";
  }

  if (category === "Legitimerad läkare") {
    return "Legitimerad läkare";
  }

  return "Läkare";
}

export function buildRoleSummary(title = "", context = "") {
  const normalized = normalizeForCompare(`${title} ${context}`);
  const roleLabel = inferRoleLabel(title, context);
  const specialty = detectSpecialty(normalized);
  const compact = normalizeWhitespace(context);

  if (/ansokan misslyckades|ladda om sidan|fornamn|efternamn|personligt brev/i.test(normalizeForCompare(compact))) {
    return specialty && roleLabel.startsWith("Specialistläkare")
      ? `Söker ${roleLabel.toLowerCase()} med tydligt fokus på ${specialty}.`
      : `Söker ${roleLabel.toLowerCase()} med relevant klinisk erfarenhet och gott patientfokus.`;
  }

  const spotlight = splitSpotlightSentences(compact).find((sentence) =>
    /specialist|legitimerad|underlakare|bt|lakarexamen|allmanmedicin|psykiatri|onkologi|gynekologi|kirurg|anestesi|barn|vi soker|soker en|soker dig|kvalifikation|krav/i.test(
      normalizeForCompare(sentence)
    ) &&
    !/kontakt|telefon|mail|e post|facklig/i.test(normalizeForCompare(sentence))
  );

  if (spotlight) {
    return spotlight;
  }

  if (specialty && roleLabel.startsWith("Specialistläkare")) {
    return `Söker ${roleLabel.toLowerCase()} med tydligt fokus på ${specialty}.`;
  }

  if (roleLabel === "Underläkare") {
    return "Söker underläkare eller läkare med tidig klinisk erfarenhet och stark utvecklingsvilja.";
  }

  if (roleLabel === "BT-läkare") {
    return "Söker BT-läkare med god klinisk grund, samarbetsförmåga och vilja att utvecklas i verksamheten.";
  }

  if (roleLabel.startsWith("ST-läkare")) {
    return specialty
      ? `Söker ${roleLabel.toLowerCase()} med handledningsbar kompetens och tydligt intresse för ${specialty}.`
      : "Söker ST-läkare med god klinisk grund, utvecklingsdriv och stark samarbetsförmåga.";
  }

  if (roleLabel === "Legitimerad läkare") {
    return specialty
      ? `Söker legitimerad läkare med erfarenhet eller intresse för ${specialty}.`
      : "Söker legitimerad läkare med gott patientfokus, struktur och samarbetsförmåga.";
  }

  return specialty
    ? `Söker läkare med inriktning mot ${specialty} och ett tydligt patientfokus.`
    : "Söker läkare med relevant kompetens, trygg klinisk bedömning och god samarbetsförmåga.";
}

function splitSpotlightSentences(text = "") {
  return text
    .split(/(?<=[.!?])\s+|\s+\|\s+|\n+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 260);
}

export function extractEmails(text = "") {
  return Array.from(
    new Set(
      (normalizeWhitespace(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) =>
        email.toLowerCase()
      )
    )
  );
}

function normalizePhoneCandidate(value = "") {
  const candidate = normalizeWhitespace(value);
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 12) {
    return null;
  }

  return candidate;
}

export function extractPhones(text = "") {
  const matches =
    normalizeWhitespace(text).match(/(?<!\d)(?:\+46\s?(?:\(0\)\s?)?|0)[\d\s-]{7,18}\d(?!\d)/g) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => normalizePhoneCandidate(match))
        .filter(Boolean)
    )
  );
}

function extractNameFromSnippet(snippet = "", markerPattern = /Kontakt/i) {
  const prepared = normalizeWhitespace(snippet).replace(/([a-zåäö])([A-ZÅÄÖ])/g, "$1 $2");
  const tail = prepared
    .replace(markerPattern, " ")
    .split(/\b(?:Kontakt|Telefon|Tel|E-post|Email|Facklig|Ansök|Publicerad)\b/i)[0]
    .replace(/^[:\s,-]+/, "")
    .trim();

  const normalizedTail = tail.replace(/^([a-zåäö])/, (match) => match.toUpperCase());
  const nameMatch = normalizedTail.match(
    /([A-ZÅÄÖ][A-Za-zÅÄÖåäö.\-]+(?:\s+[A-ZÅÄÖ][A-Za-zÅÄÖåäö.\-]+){0,3})/
  );
  return nameMatch ? normalizeWhitespace(nameMatch[1]) : "";
}

export function extractContactEntries(text = "", sourceName = "") {
  const compact = normalizeWhitespace(text);
  const allEmails = extractEmails(compact);
  const allPhones = extractPhones(compact);
  const entries = [];
  const invalidNames = new Set([
    "en",
    "med",
    "telefon",
    "mail",
    "kontakt",
    "fackliga",
    "ansok",
    "genomga",
  ]);

  const patterns = [
    { role: "Verksamhetschef", regex: /Verksamhetschef[^.]{0,180}/gi },
    { role: "Sektionschef", regex: /Sektionschef[^.]{0,180}/gi },
    { role: "Enhetschef", regex: /Enhetschef[^.]{0,180}/gi },
    { role: "Medicinskt ansvarig", regex: /Medicinskt ansvarig(?: läkare)?[^.]{0,180}/gi },
    { role: "Rekryterande chef", regex: /Rekryterande chef[^.]{0,180}/gi },
    { role: "Kontaktperson", regex: /Kontaktperson[^.]{0,180}/gi },
    { role: "Kontakt för frågor om tjänsten", regex: /Kontakt(?:\s+[A-ZÅÄÖ][^.]{0,160}| för frågor om tjänsten[^.]{0,160})/gi },
  ];

  patterns.forEach(({ role, regex }) => {
    let match;
    while ((match = regex.exec(compact))) {
      const snippet = normalizeWhitespace(match[0]);
      const emails = extractEmails(snippet);
      const phones = extractPhones(snippet);
      const entry = {
        role,
        title: role,
        name: extractNameFromSnippet(snippet, new RegExp(role, "i")) || extractNameFromSnippet(snippet),
        email: emails[0] ?? (allEmails.length === 1 ? allEmails[0] : ""),
        phone: phones[0] ?? (allPhones.length === 1 ? allPhones[0] : ""),
        sourceName,
      };

      if (invalidNames.has(normalizeForCompare(entry.name))) {
        entry.name = "";
      }

      if (entry.name && !/\s/.test(entry.name) && !entry.email && !entry.phone) {
        entry.name = "";
      }

      if (!entry.name && !entry.email && !entry.phone) {
        continue;
      }

      entries.push(entry);
    }
  });

  if (!entries.length && (allEmails.length || allPhones.length)) {
    entries.push({
      role: "Kontaktperson",
      title: "Kontaktperson",
      name: "",
      email: allEmails[0] ?? "",
      phone: allPhones[0] ?? "",
      sourceName,
    });
  }

  const deduped = new Map();
  entries.forEach((entry) => {
    const key = [
      normalizeForCompare(entry.name),
      normalizeForCompare(entry.email),
      normalizeForCompare(entry.phone),
    ].join("|");

    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  });

  return Array.from(deduped.values()).slice(0, 6);
}

function isPlausibleEmployer(value = "") {
  const trimmed = normalizeWhitespace(value);
  const normalized = normalizeForCompare(value);
  const singleWord = normalized.split(" ").filter(Boolean);
  const strongEmployerWords = /capio|meliva|kry|karolinska|sodersjukhuset|akademiska|praktikertjanst|familjelakarna/i;
  return (
    Boolean(normalized) &&
    /^[A-ZÅÄÖ]/.test(trimmed) &&
    !/annonsera jobb|rekryteringssystem|vanliga fragor|jobbsokare|karriartips|integritet|cookie|hitta dromjobbet|logga in|sign in|linkedin|varbi/i.test(
      normalized
    ) &&
    !/st inom|st till|leg lakare|underlakare|specialistlakare|nu soker vi|vi erbjuder|en dynamisk miljo dar du|att vaxa/i.test(
      normalized
    ) &&
    normalized.split(" ").length <= 10 &&
    normalized.length <= 80 &&
    (!looksLikeStandaloneLocation(normalized) || strongEmployerWords.test(normalized)) &&
    !(singleWord.length === 1 && singleWord[0].length < 4)
  );
}

function sanitizeEmployerValue(value = "") {
  return normalizeWhitespace(value)
    .split(
      /\b(?:Sök jobbet|Ansök|Publicerad|Sista ansökningsdag|Tillträde|Startdatum|Löneform|Sysselsättningsgrad|Ort|Län|Vill du|Vi söker|Intresseanmälan|bedrivs|Nu söker vi)\b/i
    )[0]
    .replace(/\s{2,}/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function sanitizeStartInfo(value = "") {
  return normalizeWhitespace(value)
    .replace(/^(?:sdatum|datum)\s*:\s*/i, "")
    .split(/\b(?:Löneform|Antal lediga befattningar|Sysselsättningsgrad|Ort|Län|Land|Kontakt|Ansök|Publicerad|Sista ansökningsdag)\b/i)[0]
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isPlausibleStartInfo(value = "") {
  const normalized = normalizeForCompare(value);
  return (
    Boolean(normalized) &&
    normalized.length >= 3 &&
    normalized.length <= 90 &&
    !/sidan|meny|halso och sjukvard|kultur|kollektivtrafik|regional utveckling|demokrati|politik|forskning|integritet|cookie|jobbsokare/i.test(
      normalized
    )
  );
}

function looksLikeStandaloneLocation(value = "") {
  return /^(stockholm|solna|uppsala|enkoping|knivsta|tierp|osthammar|goteborg|malmo|ystad|norrkoping|visby|bollnas|landskrona|strangnas|huddinge|danderyd)$/i.test(
    value
  );
}
