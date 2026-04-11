const repoUrl = "https://github.com/marcdshark666/Jobbans-kanDrSwe";
const actionsUrl = `${repoUrl}/actions`;
const dataUrl = "./data/jobs-cache.json";

const templates = [
  {
    id: "stockholm",
    label: "Stockholm",
    description: "Fokuserar på jobb i Stockholm och Stockholms län.",
  },
  {
    id: "uppsala",
    label: "Uppsala",
    description: "Visar jobb i Uppsala, Enköping, Knivsta och övriga delar av Uppsala län.",
  },
  {
    id: "hela-sverige",
    label: "Hela Sverige",
    description: "Visar alla relevanta läkarjobb i hela Sverige.",
  },
];

const categories = [
  "Underläkare",
  "BT-läkare",
  "ST-läkare",
  "Legitimerad läkare",
  "Specialist",
];

const pipelineViews = [
  { id: "all", label: "Aktiva" },
  { id: "bookmarks", label: "Bokmärken" },
  { id: "applied", label: "Sökt" },
  { id: "interview", label: "Intervju" },
  { id: "rejected", label: "Avböjt" },
  { id: "not_interested", label: "Ej intressant" },
];

const ageFilters = [
  { id: "all", label: "Alla datum" },
  { id: "24h", label: "Senaste 24h" },
  { id: "month", label: "Den här månaden" },
  { id: "2months", label: "Senaste 2 månaderna" },
];

const sortOptions = [
  { id: "earliest", label: "Tidigast publicerad först" },
  { id: "latest", label: "Senast publicerad först" },
  { id: "title", label: "Titel A-Ö" },
];

const storageKey = "doctor-jobs-radar-v6";
const unknownLocationLabels = new Set(["", "okänd ort", "okand ort", "unknown", "remote", "distans"]);

const state = {
  jobs: [],
  sourceSummaries: [],
  stats: {},
  lastUpdated: null,
  nextScheduledRefreshAt: null,
  activeTemplate: "stockholm",
  activePipeline: "all",
  activeAgeFilter: "all",
  activeSort: "earliest",
  searchQuery: "",
  activeCategories: new Set(categories),
  activeSources: new Set(),
  bookmarks: new Set(),
  statuses: {},
  accounts: {},
  activeAccountId: "",
  activeAccountName: "",
  selectedCommuteJobId: "",
  commuteOrigin: "",
  commuteDestination: "",
  commuteDepartureAt: "",
  commuteResults: [],
  commuteStatusMessage: "",
};

const elements = {
  accountInput: document.querySelector("#accountInput"),
  createAccountButton: document.querySelector("#createAccountButton"),
  loginButton: document.querySelector("#loginButton"),
  signoutButton: document.querySelector("#signoutButton"),
  accountBadge: document.querySelector("#accountBadge"),
  accountHint: document.querySelector("#accountHint"),
  accountPresets: document.querySelector("#accountPresets"),
  notificationToggle: document.querySelector("#notificationToggle"),
  notificationFrequencySelect: document.querySelector("#notificationFrequencySelect"),
  notificationTemplateFilters: document.querySelector("#notificationTemplateFilters"),
  notificationCategoryFilters: document.querySelector("#notificationCategoryFilters"),
  notificationHint: document.querySelector("#notificationHint"),
  templateButtons: document.querySelector("#templateButtons"),
  pipelineTabs: document.querySelector("#pipelineTabs"),
  categoryFilters: document.querySelector("#categoryFilters"),
  ageFilters: document.querySelector("#ageFilters"),
  sourceList: document.querySelector("#sourceList"),
  summaryGrid: document.querySelector("#summaryGrid"),
  categoryBoards: document.querySelector("#categoryBoards"),
  boardTitle: document.querySelector("#boardTitle"),
  boardSubTitle: document.querySelector("#boardSubTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshStatus: document.querySelector("#refreshStatus"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  heroLiveCount: document.querySelector("#heroLiveCount"),
  heroSourceCount: document.querySelector("#heroSourceCount"),
  heroNextRefresh: document.querySelector("#heroNextRefresh"),
  jobCardTemplate: document.querySelector("#jobCardTemplate"),
  generatorAdInput: document.querySelector("#generatorAdInput"),
  generatorProfileInput: document.querySelector("#generatorProfileInput"),
  generatorLetterOutput: document.querySelector("#generatorLetterOutput"),
  generateLetterButton: document.querySelector("#generateLetterButton"),
  copyLetterButton: document.querySelector("#copyLetterButton"),
  generatorStatus: document.querySelector("#generatorStatus"),
  commuteSelectedJob: document.querySelector("#commuteSelectedJob"),
  commuteOriginInput: document.querySelector("#commuteOriginInput"),
  commuteDestinationInput: document.querySelector("#commuteDestinationInput"),
  commuteDepartureInput: document.querySelector("#commuteDepartureInput"),
  useLocationButton: document.querySelector("#useLocationButton"),
  calculateCommuteButton: document.querySelector("#calculateCommuteButton"),
  commuteResultGrid: document.querySelector("#commuteResultGrid"),
  commuteStatus: document.querySelector("#commuteStatus"),
};

function normalizeLookup(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnknownLocation(location = "") {
  return unknownLocationLabels.has(normalizeLookup(location));
}

function toDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestamp(value) {
  const date = toDate(value);
  if (!date) {
    return value || "Ingen uppdatering ännu";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(value) {
  const date = toDate(value);
  if (!date) {
    return value || "Ej angivet";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
  }).format(date);
}

function isRelativePublicationValue(value = "") {
  return /(sedan|early applicant|actively hiring)/i.test(String(value));
}

function parsePublicationValue(value, fallbackTimestamp = null) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const isoDateTimeMatch = normalized.match(/\b20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b/);
  if (isoDateTimeMatch) {
    return toDate(isoDateTimeMatch[0].replace(" ", "T"));
  }

  const isoDateMatch = normalized.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  if (isoDateMatch) {
    return toDate(`${isoDateMatch[0]}T00:00:00`);
  }

  const directDate = toDate(normalized);
  if (directDate) {
    return directDate;
  }

  const relativeMatch = normalizeLookup(normalized).match(
    /(\d+)\s+(minut|minuter|timme|timmar|hour|hours|dag|dagar|day|days|vecka|veckor|week|weeks|manad|manader|month|months|ar|year|years)\s+sedan/
  );

  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const base = toDate(fallbackTimestamp) ?? toDate(state.lastUpdated) ?? new Date();
    const result = new Date(base);

    if (/minut/.test(unit)) {
      result.setMinutes(result.getMinutes() - amount);
      return result;
    }

    if (/timme|hour/.test(unit)) {
      result.setHours(result.getHours() - amount);
      return result;
    }

    if (/dag|day/.test(unit)) {
      result.setDate(result.getDate() - amount);
      return result;
    }

    if (/vecka|week/.test(unit)) {
      result.setDate(result.getDate() - amount * 7);
      return result;
    }

    if (/manad|month/.test(unit)) {
      result.setMonth(result.getMonth() - amount);
      return result;
    }

    if (/ar|year/.test(unit)) {
      result.setFullYear(result.getFullYear() - amount);
      return result;
    }
  }

  if (/be an early applicant|actively hiring/i.test(normalized)) {
    return toDate(fallbackTimestamp) ?? toDate(state.lastUpdated);
  }

  return null;
}

function buildPublicationLabel(rawValue, publicationDate, fallbackDate, isVerified) {
  if (rawValue && isVerified && !isRelativePublicationValue(rawValue)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue.trim())) {
      return formatDateOnly(publicationDate);
    }

    return formatTimestamp(publicationDate);
  }

  if (rawValue && publicationDate && isRelativePublicationValue(rawValue)) {
    return `Ca ${formatTimestamp(publicationDate)} · ${rawValue}`;
  }

  if (rawValue && !isVerified) {
    return `Datum på sidan: ${rawValue}`;
  }

  if (publicationDate) {
    return formatTimestamp(publicationDate);
  }

  if (fallbackDate) {
    return `Upptäckt ${formatTimestamp(fallbackDate)}`;
  }

  return "Ej angivet";
}

function getPublicationMeta(job) {
  const detectedDate = toDate(job.detectedAt) ?? toDate(job.firstSeenAt) ?? toDate(state.lastUpdated);
  const parsedPublication = parsePublicationValue(job.publishedAt, detectedDate);
  const now = Date.now();
  const isFutureLikePublication =
    Boolean(parsedPublication) && parsedPublication.getTime() > now + 24 * 60 * 60 * 1000;
  const verifiedPublicationDate = isFutureLikePublication ? null : parsedPublication;
  const referenceDate = verifiedPublicationDate ?? detectedDate;

  return {
    rawPublishedAt: job.publishedAt ?? null,
    publicationDate: verifiedPublicationDate,
    referenceDate,
    publicationLabel: buildPublicationLabel(
      job.publishedAt ?? "",
      verifiedPublicationDate,
      detectedDate,
      Boolean(verifiedPublicationDate)
    ),
  };
}

function normalizeAccountId(value = "") {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("@")) {
    return trimmed.slice(0, 120);
  }

  return trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function createNotificationSettings() {
  return {
    enabled: false,
    frequencyHours: 6,
    templates: templates.map((template) => template.id),
    categories: [...categories],
    syncMode: "local",
    syncedAt: null,
    statusMessage: "",
  };
}

function normalizeNotificationSettings(settings = {}, legacyAccount = {}) {
  const frequencyCandidate = Number(
    settings.frequencyHours ?? legacyAccount.notificationFrequencyHours ?? 6
  );
  const templatesCandidate = Array.isArray(settings.templates)
    ? settings.templates
    : templates.map((template) => template.id);
  const categoriesCandidate = Array.isArray(settings.categories)
    ? settings.categories
    : [...categories];
  const normalizedTemplates = templatesCandidate.filter((templateId) =>
    templates.some((template) => template.id === templateId)
  );
  const normalizedCategories = categoriesCandidate.filter((category) => categories.includes(category));

  return {
    enabled: Boolean(settings.enabled ?? legacyAccount.notificationsEnabled ?? false),
    frequencyHours: [6, 12, 24].includes(frequencyCandidate) ? frequencyCandidate : 6,
    templates: normalizedTemplates.length ? normalizedTemplates : templates.map((template) => template.id),
    categories: normalizedCategories.length ? normalizedCategories : [...categories],
    syncMode: settings.syncMode ?? "local",
    syncedAt: settings.syncedAt ?? null,
    statusMessage: settings.statusMessage ?? "",
  };
}

function createAccountProfile(accountName = "") {
  return {
    name: accountName,
    bookmarks: [],
    statuses: {},
    notificationSettings: createNotificationSettings(),
    lastUsedAt: new Date().toISOString(),
  };
}

function normalizeAccountProfile(accountId, account = {}) {
  const base = createAccountProfile(account.name || accountId);
  return {
    ...base,
    ...account,
    name: account.name || base.name || accountId,
    bookmarks: Array.isArray(account.bookmarks) ? account.bookmarks : [],
    statuses: account.statuses && typeof account.statuses === "object" ? account.statuses : {},
    notificationSettings: normalizeNotificationSettings(account.notificationSettings, account),
  };
}

function ensureAccountProfile(accountId, accountName = "") {
  state.accounts[accountId] = normalizeAccountProfile(
    accountId,
    state.accounts[accountId] ?? createAccountProfile(accountName)
  );
  return state.accounts[accountId];
}

function getActiveAccountProfile() {
  return state.activeAccountId ? ensureAccountProfile(state.activeAccountId, state.activeAccountName) : null;
}

function getActiveNotificationSettings() {
  return getActiveAccountProfile()?.notificationSettings ?? createNotificationSettings();
}

function saveActiveAccountState() {
  if (!state.activeAccountId) {
    return;
  }

  state.accounts[state.activeAccountId] = {
    ...ensureAccountProfile(state.activeAccountId, state.activeAccountName),
    name: state.activeAccountName || state.activeAccountId,
    bookmarks: Array.from(state.bookmarks),
    statuses: state.statuses,
    lastUsedAt: new Date().toISOString(),
  };
}

function loadAccountState(accountId) {
  const account = accountId ? ensureAccountProfile(accountId, state.activeAccountName) : null;
  state.bookmarks = new Set(account?.bookmarks ?? []);
  state.statuses = account?.statuses ?? {};
}

function setActiveAccount(accountName) {
  saveActiveAccountState();

  const normalizedId = normalizeAccountId(accountName);
  if (!normalizedId) {
    state.activeAccountId = "";
    state.activeAccountName = "";
    state.bookmarks = new Set();
    state.statuses = {};
    return;
  }

  ensureAccountProfile(normalizedId, accountName.trim());

  state.activeAccountId = normalizedId;
  state.activeAccountName = state.accounts[normalizedId].name || accountName.trim() || normalizedId;
  loadAccountState(normalizedId);
}

function isSignedIn() {
  return Boolean(state.activeAccountId);
}

function looksLikeEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function buildNextMondayEight() {
  const date = new Date();
  const day = date.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  date.setDate(date.getDate() + daysUntilMonday);
  date.setHours(8, 0, 0, 0);
  return date.toISOString().slice(0, 16);
}

function loadStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (!parsed) {
      return;
    }

    state.activeTemplate = parsed.activeTemplate ?? state.activeTemplate;
    state.activePipeline = parsed.activePipeline ?? state.activePipeline;
    state.activeAgeFilter = parsed.activeAgeFilter ?? state.activeAgeFilter;
    state.activeSort = parsed.activeSort ?? state.activeSort;
    state.accounts = Object.fromEntries(
      Object.entries(parsed.accounts ?? {}).map(([accountId, account]) => [
        accountId,
        normalizeAccountProfile(accountId, account),
      ])
    );
    if (
      Object.keys(state.accounts).length === 0 &&
      ((parsed.bookmarks ?? []).length || Object.keys(parsed.statuses ?? {}).length)
    ) {
      state.accounts["lokal-profil"] = normalizeAccountProfile("lokal-profil", {
        name: "lokal-profil",
        bookmarks: parsed.bookmarks ?? [],
        statuses: parsed.statuses ?? {},
        lastUsedAt: new Date().toISOString(),
      });
      state.activeAccountId = parsed.activeAccountId ?? "lokal-profil";
      state.activeAccountName = parsed.activeAccountName ?? "lokal-profil";
    } else {
      state.activeAccountId = parsed.activeAccountId ?? "";
      state.activeAccountName =
        parsed.activeAccountName ?? state.accounts[state.activeAccountId]?.name ?? "";
    }

    const restoredCategories = (parsed.activeCategories ?? []).filter((item) =>
      categories.includes(item)
    );
    if (restoredCategories.length) {
      state.activeCategories = new Set(restoredCategories);
    }

    state.activeSources = new Set(parsed.activeSources ?? []);
    state.selectedCommuteJobId = parsed.selectedCommuteJobId ?? "";
    state.commuteOrigin = parsed.commuteOrigin ?? "";
    state.commuteDestination = parsed.commuteDestination ?? "";
    state.commuteDepartureAt = parsed.commuteDepartureAt ?? buildNextMondayEight();
    loadAccountState(state.activeAccountId);
  } catch (error) {
    console.warn("Kunde inte läsa sparat tillstånd", error);
  }
}

function persistState() {
  saveActiveAccountState();
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      activeTemplate: state.activeTemplate,
      activePipeline: state.activePipeline,
      activeAgeFilter: state.activeAgeFilter,
      activeSort: state.activeSort,
      activeCategories: Array.from(state.activeCategories),
      activeSources: Array.from(state.activeSources),
      accounts: state.accounts,
      activeAccountId: state.activeAccountId,
      activeAccountName: state.activeAccountName,
      selectedCommuteJobId: state.selectedCommuteJobId,
      commuteOrigin: state.commuteOrigin,
      commuteDestination: state.commuteDestination,
      commuteDepartureAt: state.commuteDepartureAt,
    })
  );
}

function getMergedGroupKey(job, duplicateCounts) {
  const duplicateCount = duplicateCounts.get(job.duplicateHintKey) ?? 0;
  return duplicateCount > 1 ? `duplicate:${job.duplicateHintKey}` : `history:${job.historyKey || job.id}`;
}

function buildSourceEntries(groupJobs) {
  const entries = groupJobs.map((job) => {
    const publication = getPublicationMeta(job);

    return {
      sourceId: job.sourceId,
      sourceName: job.sourceName,
      title: job.title,
      location: job.location,
      link: job.link,
      rawPublishedAt: publication.rawPublishedAt,
      publicationDate: publication.publicationDate,
      referenceDate: publication.referenceDate,
      publicationLabel: publication.publicationLabel,
      detectedAt: job.detectedAt,
      firstSeenAt: job.firstSeenAt,
      roleSummary: job.roleSummary ?? "",
      roleLabel: job.roleLabel ?? job.category ?? "Läkare",
      category: job.category ?? "Legitimerad läkare",
      detailSnippet: job.detailSnippet ?? "",
      employer: job.employer ?? "",
      startInfo: job.startInfo ?? "",
      contacts: Array.isArray(job.contacts) ? job.contacts : [],
    };
  });

  entries.sort((left, right) => {
    if (left.referenceDate && right.referenceDate) {
      const difference = left.referenceDate.getTime() - right.referenceDate.getTime();
      if (difference !== 0) {
        return difference;
      }
    }

    if (left.referenceDate && !right.referenceDate) {
      return -1;
    }

    if (!left.referenceDate && right.referenceDate) {
      return 1;
    }

    return left.sourceName.localeCompare(right.sourceName, "sv");
  });

  return entries;
}

function getCategorySpecificity(category = "") {
  const map = {
    Specialist: 5,
    "ST-läkare": 4,
    "BT-läkare": 3,
    Underläkare: 2,
    "Legitimerad läkare": 1,
  };

  return map[category] ?? 0;
}

function pickPreferredCategory(groupJobs) {
  return [...groupJobs]
    .sort((left, right) => getCategorySpecificity(right.category) - getCategorySpecificity(left.category))[0]
    ?.category;
}

function pickRoleSummary(groupJobs, sourceEntries) {
  return (
    sourceEntries.find((entry) => entry.roleSummary)?.roleSummary ??
    groupJobs.find((job) => job.roleSummary)?.roleSummary ??
    "Ingen kort sammanfattning kunde utläsas ännu."
  );
}

function pickRoleLabel(groupJobs, sourceEntries, category) {
  return (
    sourceEntries.find((entry) => entry.roleLabel)?.roleLabel ??
    groupJobs.find((job) => job.roleLabel)?.roleLabel ??
    category ??
    "Läkare"
  );
}

function buildContactKey(contact) {
  return [
    normalizeLookup(contact.name || ""),
    normalizeLookup(contact.email || ""),
    normalizeLookup(contact.phone || ""),
  ].join("|");
}

function combineContacts(groupJobs) {
  const combined = [];
  const seen = new Set();

  groupJobs.forEach((job) => {
    (job.contacts ?? []).forEach((contact) => {
      const key = buildContactKey(contact);
      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      combined.push(contact);
    });
  });

  return combined;
}

function pickBestLocation(groupJobs, sourceEntries) {
  const candidateFromEntries = sourceEntries.find((entry) => !isUnknownLocation(entry.location));
  if (candidateFromEntries) {
    return candidateFromEntries.location;
  }

  const candidateFromJobs = groupJobs.find((job) => !isUnknownLocation(job.location));
  if (candidateFromJobs) {
    return candidateFromJobs.location;
  }

  return sourceEntries[0]?.location ?? groupJobs[0]?.location ?? "Okänd ort";
}

function buildMergedJob(groupKey, groupJobs) {
  const sourceEntries = buildSourceEntries(groupJobs);
  const primaryEntry = sourceEntries[0] ?? null;
  const sourceIds = Array.from(new Set(sourceEntries.map((entry) => entry.sourceId)));
  const sourceNames = Array.from(new Set(sourceEntries.map((entry) => entry.sourceName)));
  const category = pickPreferredCategory(groupJobs) ?? "Legitimerad läkare";
  const oldestPublicationDate = sourceEntries.find((entry) => entry.referenceDate)?.referenceDate ?? null;
  const latestPublicationDate = [...sourceEntries].reverse().find((entry) => entry.referenceDate)?.referenceDate ?? null;
  const firstSeenAt =
    groupJobs
      .map((job) => toDate(job.firstSeenAt))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const timesSeenAcrossRefreshes = Math.max(...groupJobs.map((job) => job.timesSeenAcrossRefreshes ?? 1), 1);
  const location = pickBestLocation(groupJobs, sourceEntries);
  const contacts = combineContacts(groupJobs);
  const roleSummary = pickRoleSummary(groupJobs, sourceEntries);
  const roleLabel = pickRoleLabel(groupJobs, sourceEntries, category);
  const employerCandidate =
    sourceEntries.find((entry) => entry.employer)?.employer ??
    groupJobs.find((job) => job.employer)?.employer ??
    "";
  const employer =
    employerCandidate && normalizeLookup(employerCandidate) !== normalizeLookup(location)
      ? employerCandidate
      : "";
  const startInfo =
    sourceEntries.find((entry) => entry.startInfo)?.startInfo ??
    groupJobs.find((job) => job.startInfo)?.startInfo ??
    "";

  return {
    id: `group:${groupKey}`,
    groupKey,
    title: primaryEntry?.title ?? groupJobs[0]?.title ?? "Okänd annons",
    category,
    roleLabel,
    roleSummary,
    location,
    employer,
    startInfo,
    stockholmMatch: groupJobs.some((job) => job.stockholmMatch),
    uppsalaMatch: groupJobs.some((job) => job.uppsalaMatch),
    sourceEntries,
    sourceIds,
    sourceNames,
    sourceName: sourceEntries.length === 1 ? primaryEntry?.sourceName ?? "Okänd källa" : `${sourceEntries.length} källor`,
    link: primaryEntry?.link ?? "#",
    oldestPublicationDate,
    latestPublicationDate,
    oldestPublicationLabel: primaryEntry?.publicationLabel ?? "Ej angivet",
    isDuplicate: sourceEntries.length > 1,
    duplicateCount: sourceEntries.length,
    seenBefore: groupJobs.some((job) => job.seenBefore),
    firstSeenAt,
    contacts,
    firstSeenSource:
      groupJobs.find((job) => job.firstSeenSource)?.firstSeenSource ?? sourceNames[0] ?? "Okänd källa",
    timesSeenAcrossRefreshes,
    searchText: [
      primaryEntry?.title ?? "",
      location,
      category,
      roleLabel,
      roleSummary,
      employer,
      startInfo,
      ...sourceNames,
      ...contacts.flatMap((contact) => [contact.name ?? "", contact.role ?? "", contact.email ?? ""]),
    ]
      .join(" ")
      .toLowerCase(),
  };
}

function getGroupedJobs() {
  const duplicateCounts = new Map();

  state.jobs.forEach((job) => {
    if (!job.duplicateHintKey) {
      return;
    }

    duplicateCounts.set(job.duplicateHintKey, (duplicateCounts.get(job.duplicateHintKey) ?? 0) + 1);
  });

  const groupedJobs = new Map();

  state.jobs.forEach((job) => {
    const groupKey = getMergedGroupKey(job, duplicateCounts);
    if (!groupedJobs.has(groupKey)) {
      groupedJobs.set(groupKey, []);
    }

    groupedJobs.get(groupKey).push(job);
  });

  return Array.from(groupedJobs.entries()).map(([groupKey, groupJobs]) =>
    buildMergedJob(groupKey, groupJobs)
  );
}

function getPipelineStatus(jobId) {
  return state.statuses[jobId] ?? "active";
}

function matchesTemplate(job) {
  if (state.activeTemplate === "hela-sverige") {
    return true;
  }

  if (state.activeTemplate === "uppsala") {
    return job.uppsalaMatch;
  }

  return job.stockholmMatch;
}

function matchesPipeline(job) {
  const status = getPipelineStatus(job.id);

  if (state.activePipeline === "all") {
    return status === "active";
  }

  if (state.activePipeline === "bookmarks") {
    return state.bookmarks.has(job.id);
  }

  return status === state.activePipeline;
}

function matchesSearch(job) {
  if (!state.searchQuery) {
    return true;
  }

  return job.searchText.includes(state.searchQuery.toLowerCase());
}

function matchesSourceFilter(job) {
  return state.activeSources.size === 0
    ? true
    : job.sourceIds.some((sourceId) => state.activeSources.has(sourceId));
}

function getJobReferenceDate(job) {
  return job.latestPublicationDate ?? job.oldestPublicationDate ?? null;
}

function matchesAgeFilter(job) {
  if (state.activeAgeFilter === "all") {
    return true;
  }

  const referenceDate = getJobReferenceDate(job);
  if (!referenceDate) {
    return false;
  }

  const now = new Date();

  if (state.activeAgeFilter === "24h") {
    return now.getTime() - referenceDate.getTime() <= 24 * 60 * 60 * 1000;
  }

  if (state.activeAgeFilter === "month") {
    return (
      referenceDate.getFullYear() === now.getFullYear() &&
      referenceDate.getMonth() === now.getMonth()
    );
  }

  if (state.activeAgeFilter === "2months") {
    const threshold = new Date(now);
    threshold.setMonth(threshold.getMonth() - 2);
    return referenceDate.getTime() >= threshold.getTime();
  }

  return true;
}

function compareJobsForSort(left, right) {
  if (state.activeSort === "title") {
    return left.title.localeCompare(right.title, "sv");
  }

  if (state.activeSort === "latest") {
    const leftDate = left.latestPublicationDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightDate = right.latestPublicationDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }
  } else {
    const leftDate = left.oldestPublicationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDate = right.oldestPublicationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }
  }

  if (left.duplicateCount !== right.duplicateCount) {
    return right.duplicateCount - left.duplicateCount;
  }

  return left.title.localeCompare(right.title, "sv");
}

function getFilteredJobs() {
  return getGroupedJobs()
    .filter(
      (job) =>
        state.activeCategories.has(job.category) &&
        matchesTemplate(job) &&
        matchesPipeline(job) &&
        matchesSearch(job) &&
        matchesAgeFilter(job) &&
        matchesSourceFilter(job)
    )
    .sort(compareJobsForSort);
}

function getStatusCounts() {
  const counts = {
    active: 0,
    bookmarks: 0,
    applied: 0,
    interview: 0,
    rejected: 0,
    not_interested: 0,
  };

  getGroupedJobs().forEach((job) => {
    const status = getPipelineStatus(job.id);

    if (status === "active") {
      counts.active += 1;
    }

    if (status === "applied") {
      counts.applied += 1;
    }

    if (status === "interview") {
      counts.interview += 1;
    }

    if (status === "rejected") {
      counts.rejected += 1;
    }

    if (status === "not_interested") {
      counts.not_interested += 1;
    }

    if (state.bookmarks.has(job.id)) {
      counts.bookmarks += 1;
    }
  });

  return counts;
}

function getJobsForCounts() {
  return getGroupedJobs().filter(
    (job) =>
      matchesTemplate(job) &&
      matchesSearch(job) &&
      matchesAgeFilter(job) &&
      matchesSourceFilter(job)
  );
}

function getJobsForSourceCounts() {
  return getGroupedJobs().filter(
    (job) => matchesTemplate(job) && matchesSearch(job) && matchesAgeFilter(job)
  );
}

function countByCategory() {
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  getJobsForCounts().forEach((job) => {
    counts[job.category] += 1;
  });
  return counts;
}

function countBySource() {
  const counts = {};

  getJobsForSourceCounts().forEach((job) => {
    job.sourceIds.forEach((sourceId) => {
      counts[sourceId] = (counts[sourceId] ?? 0) + 1;
    });
  });

  return counts;
}

function renderTemplates() {
  elements.templateButtons.innerHTML = "";

  templates.forEach((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `template-button ${state.activeTemplate === template.id ? "is-active" : ""}`;
    button.textContent = template.label;
    button.title = template.description;
    button.addEventListener("click", () => {
      state.activeTemplate = template.id;
      persistState();
      render();
    });
    elements.templateButtons.append(button);
  });
}

function renderPipelineTabs() {
  const statusCounts = getStatusCounts();
  const countMap = {
    all: statusCounts.active,
    bookmarks: statusCounts.bookmarks,
    applied: statusCounts.applied,
    interview: statusCounts.interview,
    rejected: statusCounts.rejected,
    not_interested: statusCounts.not_interested,
  };

  elements.pipelineTabs.innerHTML = "";

  pipelineViews.forEach((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pipeline-tab ${state.activePipeline === view.id ? "is-active" : ""}`;
    button.innerHTML = `<span>${view.label}</span><strong>${countMap[view.id] ?? 0}</strong>`;
    button.addEventListener("click", () => {
      state.activePipeline = view.id;
      persistState();
      render();
    });
    elements.pipelineTabs.append(button);
  });
}

function renderCategoryFilters() {
  const counts = countByCategory();
  elements.categoryFilters.innerHTML = "";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-pill ${state.activeCategories.has(category) ? "is-active" : ""}`;
    button.innerHTML = `<span>${category}</span><strong>${counts[category] ?? 0}</strong>`;
    button.addEventListener("click", () => {
      if (state.activeCategories.has(category) && state.activeCategories.size > 1) {
        state.activeCategories.delete(category);
      } else {
        state.activeCategories.add(category);
      }

      persistState();
      render();
    });
    elements.categoryFilters.append(button);
  });
}

function renderAgeFilters() {
  elements.ageFilters.innerHTML = "";

  ageFilters.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-pill ${state.activeAgeFilter === filter.id ? "is-active" : ""}`;
    button.textContent = filter.label;
    button.addEventListener("click", () => {
      state.activeAgeFilter = filter.id;
      persistState();
      render();
    });
    elements.ageFilters.append(button);
  });
}

function renderSourceList() {
  const sourceCounts = countBySource();
  elements.sourceList.innerHTML = "";

  state.sourceSummaries.forEach((source) => {
    const isVisible = state.activeSources.size === 0 || state.activeSources.has(source.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `source-item ${isVisible ? "is-active" : ""}`;
    button.dataset.status = source.status;
    button.innerHTML = `
      <div class="source-item-top">
        <strong>${source.name}</strong>
        <span>${sourceCounts[source.id] ?? source.count ?? 0}</span>
      </div>
      <p>${source.message}</p>
    `;

    button.addEventListener("click", () => {
      if (state.activeSources.has(source.id)) {
        state.activeSources.delete(source.id);
      } else {
        state.activeSources.add(source.id);
      }

      persistState();
      render();
    });

    elements.sourceList.append(button);
  });

  const footer = document.createElement("a");
  footer.className = "source-footer-link";
  footer.href = actionsUrl;
  footer.target = "_blank";
  footer.rel = "noreferrer";
  footer.textContent = "Öppna GitHub Actions för schemalagda uppdateringar";
  elements.sourceList.append(footer);
}

function renderNotificationButtons(container, items, activeValues, className, onToggle) {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${className} ${activeValues.has(item.id) ? "is-active" : ""}`;
    button.textContent = item.label;
    button.disabled = !isSignedIn() || !looksLikeEmail(state.activeAccountName);
    button.addEventListener("click", () => onToggle(item.id));
    container.append(button);
  });
}

async function syncNotificationSettings() {
  const account = getActiveAccountProfile();
  if (!account || !looksLikeEmail(state.activeAccountName)) {
    return;
  }

  const notificationSettings = getActiveNotificationSettings();

  try {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      throw new Error("GitHub Pages ar statisk");
    }

    const response = await fetch("./api/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        email: state.activeAccountName,
        notifications: notificationSettings,
      }),
    });

    if (!response.ok) {
      throw new Error(`API-fel ${response.status}`);
    }

    const payload = await response.json();
    account.notificationSettings = {
      ...notificationSettings,
      syncMode: "server",
      syncedAt: payload.subscription?.updatedAt ?? new Date().toISOString(),
      statusMessage:
        payload.message ??
        `E-postnotiser ar synkade for ${state.activeAccountName}. Avslutslank skickas med i varje mail.`,
    };
  } catch {
    account.notificationSettings = {
      ...notificationSettings,
      syncMode: "local",
      syncedAt: null,
      statusMessage: notificationSettings.enabled
        ? "Installningen ar sparad pa kontot har i webblasaren. For riktiga utskick behovs server/API eftersom GitHub Pages ar statisk."
        : "Notiser ar avstangda for kontot just nu.",
    };
  }

  persistState();
  renderAccountPanel();
}

function updateNotificationSetting(mutator) {
  const account = getActiveAccountProfile();
  if (!account) {
    return;
  }

  mutator(account.notificationSettings);
  persistState();
  renderAccountPanel();
  if (looksLikeEmail(state.activeAccountName)) {
    syncNotificationSettings();
  }
}

function renderAccountPanel() {
  if (elements.accountInput) {
    elements.accountInput.value = state.activeAccountName;
  }

  if (elements.accountBadge) {
    elements.accountBadge.textContent = isSignedIn()
      ? `Inloggad som ${state.activeAccountName}`
      : "Ej inloggad";
  }

  if (elements.accountHint) {
    elements.accountHint.textContent = isSignedIn()
      ? "Dina bokmarken, knappstatusar och notifieringsval sparas nu under det har kontot."
      : "Skapa konto eller logga in med e-post for att spara Bokmarken, Sokt, Intervju, Avbojt och Ej intressant.";
  }

  if (elements.signoutButton) {
    elements.signoutButton.disabled = !isSignedIn();
  }

  const notificationSettings = getActiveNotificationSettings();
  const notificationsAvailable = isSignedIn() && looksLikeEmail(state.activeAccountName);

  if (elements.notificationToggle) {
    elements.notificationToggle.checked = notificationSettings.enabled;
    elements.notificationToggle.disabled = !notificationsAvailable;
  }

  if (elements.notificationFrequencySelect) {
    elements.notificationFrequencySelect.value = String(notificationSettings.frequencyHours);
    elements.notificationFrequencySelect.disabled = !notificationsAvailable || !notificationSettings.enabled;
  }

  renderNotificationButtons(
    elements.notificationTemplateFilters,
    templates,
    new Set(notificationSettings.templates),
    "template-button",
    (templateId) => {
      updateNotificationSetting((settings) => {
        const selected = new Set(settings.templates);
        if (selected.has(templateId) && selected.size > 1) {
          selected.delete(templateId);
        } else {
          selected.add(templateId);
        }
        settings.templates = Array.from(selected);
      });
    }
  );

  renderNotificationButtons(
    elements.notificationCategoryFilters,
    categories.map((category) => ({ id: category, label: category })),
    new Set(notificationSettings.categories),
    "category-pill",
    (category) => {
      updateNotificationSetting((settings) => {
        const selected = new Set(settings.categories);
        if (selected.has(category) && selected.size > 1) {
          selected.delete(category);
        } else {
          selected.add(category);
        }
        settings.categories = Array.from(selected);
      });
    }
  );

  if (elements.notificationHint) {
    if (!isSignedIn()) {
      elements.notificationHint.textContent = "Logga in med e-post for att spara notifieringsval och forbereda mailutskick.";
    } else if (!looksLikeEmail(state.activeAccountName)) {
      elements.notificationHint.textContent = "Byt till en e-postadress om du vill koppla kontot till mailnotiser.";
    } else if (notificationSettings.statusMessage) {
      elements.notificationHint.textContent = notificationSettings.statusMessage;
    } else if (notificationSettings.enabled) {
      elements.notificationHint.textContent = `Mail ar aktiverade var ${notificationSettings.frequencyHours}:e timme for ${state.activeAccountName}.`;
    } else {
      elements.notificationHint.textContent = "Aktivera e-postnotiser for att fa mail nar nya matchande jobb publiceras.";
    }
  }

  if (!elements.accountPresets) {
    return;
  }

  elements.accountPresets.innerHTML = "";

  Object.entries(state.accounts)
    .sort((left, right) => {
      const leftTime = toDate(left[1]?.lastUsedAt)?.getTime() ?? 0;
      const rightTime = toDate(right[1]?.lastUsedAt)?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 6)
    .forEach(([accountId, account]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `account-preset ${state.activeAccountId === accountId ? "is-active" : ""}`;
      button.textContent = account.name || accountId;
      button.addEventListener("click", () => {
        setActiveAccount(account.name || accountId);
        persistState();
        render();
      });
      elements.accountPresets.append(button);
    });
}

function renderSummary() {
  const groupedJobs = getGroupedJobs();
  const statusCounts = getStatusCounts();
  const summaryItems = [
    ["Live annonser", groupedJobs.length],
    ["Stockholm", groupedJobs.filter((job) => job.stockholmMatch).length],
    ["Uppsala", groupedJobs.filter((job) => job.uppsalaMatch).length],
    ["Övriga Sverige", groupedJobs.filter((job) => !job.stockholmMatch && !job.uppsalaMatch).length],
    ["Sammanslagna dubletter", groupedJobs.filter((job) => job.isDuplicate).length],
    ["Bokmärken", statusCounts.bookmarks],
    ["Sökt", statusCounts.applied],
    ["Intervju", statusCounts.interview],
    ["Avböjt", statusCounts.rejected],
    ["Ej intressant", statusCounts.not_interested],
  ];

  elements.summaryGrid.innerHTML = "";

  summaryItems.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "summary-card";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    elements.summaryGrid.append(card);
  });

  elements.heroLiveCount.textContent = `${groupedJobs.length} annonser`;
  elements.heroSourceCount.textContent = `${state.stats.sourceCount ?? 0} källor`;
  elements.heroNextRefresh.textContent = formatTimestamp(state.nextScheduledRefreshAt);
}

function createContactCard(contact) {
  const wrapper = document.createElement("article");
  wrapper.className = "job-contact-card";

  const name = document.createElement("strong");
  name.textContent = contact.name || "Kontakt hittad";

  const role = document.createElement("span");
  role.className = "job-contact-role";
  role.textContent = contact.role || "Kontakt";

  const meta = document.createElement("div");
  meta.className = "job-contact-meta";

  if (contact.title && contact.title !== contact.role) {
    const title = document.createElement("span");
    title.textContent = contact.title;
    meta.append(title);
  }

  if (contact.email) {
    const email = document.createElement("a");
    email.href = `mailto:${contact.email}`;
    email.textContent = contact.email;
    meta.append(email);
  }

  if (contact.phone) {
    const phone = document.createElement("a");
    phone.href = `tel:${contact.phone.replace(/\s+/g, "")}`;
    phone.textContent = contact.phone;
    meta.append(phone);
  }

  if (contact.sourceName) {
    const source = document.createElement("span");
    source.textContent = `Källa: ${contact.sourceName}`;
    meta.append(source);
  }

  wrapper.append(role, name, meta);
  return wrapper;
}

function findGroupedJobById(jobId = "") {
  return getGroupedJobs().find((job) => job.id === jobId) ?? null;
}

function buildCommuteDestinationLabel(job) {
  if (!job) {
    return "";
  }

  return [job.employer && job.employer !== "Ej angivet" ? job.employer : "", job.location || "", "Sverige"]
    .filter(Boolean)
    .join(", ");
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

function buildFallbackCommuteResults(origin, destination) {
  const definitions = [
    {
      id: "driving",
      label: "Bil",
      pill: "Bil",
      note: "Google Maps oppnas med biltrafik och aktuell vardagstrafik for den valda tiden.",
    },
    {
      id: "bus",
      label: "Buss",
      pill: "Kollektivt",
      note: "Google Maps oppnas i kollektivtrafiklage. Buss och ovriga byten raknas dar.",
    },
    {
      id: "rail",
      label: "Tag",
      pill: "Kollektivt",
      note: "Google Maps oppnas i kollektivtrafiklage. Tag och ovriga byten raknas dar.",
    },
    {
      id: "bicycling",
      label: "Cykel",
      pill: "Cykel",
      note: "Google Maps oppnas i cykellage sa att du snabbt kan jamfora med andra alternativ.",
    },
  ];

  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    pill: definition.pill,
    durationText: "Beraknas i Google Maps",
    distanceText: "Oppna lank for exakt restid",
    note: definition.note,
    link: buildGoogleMapsLink({
      origin,
      destination,
      modeId: definition.id,
    }),
    visualWidth: 34,
  }));
}

function createCommuteResultCard(result) {
  const card = document.createElement("article");
  card.className = "commute-result-card";
  card.innerHTML = `
    <div class="commute-result-head">
      <strong>${result.label}</strong>
      <span class="commute-mode-pill">${result.pill}</span>
    </div>
    <div class="commute-result-stats">
      <div class="commute-stat">
        <span>Restid</span>
        <strong>${result.durationText}</strong>
      </div>
      <div class="commute-stat">
        <span>Distans</span>
        <strong>${result.distanceText}</strong>
      </div>
    </div>
    <div class="commute-visual"><span style="width: ${result.visualWidth ?? 34}%"></span></div>
    <p>${result.note}</p>
  `;

  const link = document.createElement("a");
  link.className = "job-link";
  link.href = result.link;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Oppna i Google Maps";
  card.append(link);

  return card;
}

function renderCommutePanel() {
  const selectedJob = findGroupedJobById(state.selectedCommuteJobId);

  if (elements.commuteSelectedJob) {
    elements.commuteSelectedJob.textContent = selectedJob
      ? `${selectedJob.title} · ${selectedJob.employer} · ${selectedJob.location}`
      : 'Ingen annons vald annu. Tryck "Pendla hit" pa ett jobbkort for att fylla i destinationen automatiskt.';
  }

  if (elements.commuteOriginInput) {
    elements.commuteOriginInput.value = state.commuteOrigin;
  }

  if (elements.commuteDestinationInput) {
    elements.commuteDestinationInput.value = state.commuteDestination;
  }

  if (elements.commuteDepartureInput) {
    elements.commuteDepartureInput.value = state.commuteDepartureAt || buildNextMondayEight();
  }

  if (elements.commuteStatus) {
    elements.commuteStatus.textContent =
      state.commuteStatusMessage ||
      "Mandag klockan 08:00 ar forifyllt som standard for att spegla vardagstrafik.";
  }

  if (elements.commuteResultGrid) {
    elements.commuteResultGrid.innerHTML = "";

    if (!state.commuteResults.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent =
        "Valj en annons och rakna pendlingen for att fa en jamforelse mellan olika transportsatt.";
      elements.commuteResultGrid.append(empty);
      return;
    }

    state.commuteResults.forEach((result) => {
      elements.commuteResultGrid.append(createCommuteResultCard(result));
    });
  }
}

function setSelectedCommuteJob(job, { scrollIntoView = false } = {}) {
  state.selectedCommuteJobId = job.id;
  state.commuteDestination = buildCommuteDestinationLabel(job);
  state.commuteStatusMessage = `${job.title} vald for pendlingsjamforelse. Justera startadress och tid om du vill.`;
  persistState();
  renderCommutePanel();

  if (scrollIntoView && elements.commuteSelectedJob) {
    elements.commuteSelectedJob.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function createStatusButton(job, statusId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `status-chip ${getPipelineStatus(job.id) === statusId ? "is-status-active" : ""}`;
  button.dataset.status = statusId;
  button.textContent = label;
  button.disabled = !isSignedIn();
  button.title = isSignedIn()
    ? `${label} sparas i kontot ${state.activeAccountName}`
    : "Logga in med ett kontonamn for att spara status.";
  button.addEventListener("click", () => {
    if (!isSignedIn()) {
      return;
    }

    state.statuses[job.id] = statusId;
    if (statusId === "active") {
      delete state.statuses[job.id];
    }

    persistState();
    render();
  });

  return button;
}

function createJobCard(job) {
  const fragment = elements.jobCardTemplate.content.cloneNode(true);
  const bookmarkButton = fragment.querySelector(".bookmark-button");
  const category = fragment.querySelector(".job-category");
  const title = fragment.querySelector(".job-title");
  const location = fragment.querySelector(".job-location");
  const employer = fragment.querySelector(".job-employer");
  const source = fragment.querySelector(".job-source");
  const published = fragment.querySelector(".job-published");
  const seekingRole = fragment.querySelector(".job-seeking-role");
  const startInfo = fragment.querySelector(".job-start-info");
  const link = fragment.querySelector(".job-link");
  const linkCount = fragment.querySelector(".job-link-count");
  const linksList = fragment.querySelector(".job-links-list");
  const roleSummary = fragment.querySelector(".job-role-summary");
  const contactCount = fragment.querySelector(".job-contact-count");
  const contactsList = fragment.querySelector(".job-contacts-list");
  const notes = fragment.querySelector(".job-notes");
  const actions = fragment.querySelector(".job-actions");

  category.textContent = job.category;
  title.innerHTML = `<a class="job-title-link" href="${job.link}" target="_blank" rel="noreferrer">${job.title}</a>`;
  roleSummary.textContent = job.roleSummary;
  location.textContent = job.location;
  employer.textContent = job.employer || "Ej angivet";
  source.textContent =
    job.sourceEntries.length === 1 ? job.sourceEntries[0].sourceName : `${job.sourceEntries.length} källor`;
  published.textContent = job.oldestPublicationLabel;
  seekingRole.textContent = job.roleLabel;
  startInfo.textContent = job.startInfo || "Ej angivet";
  link.href = job.link;
  link.textContent = "Öppna första träffen";
  linkCount.textContent = `${job.sourceEntries.length} länk${job.sourceEntries.length === 1 ? "" : "ar"}`;
  contactCount.textContent = `${job.contacts.length} kontakt${job.contacts.length === 1 ? "" : "er"}`;

  job.sourceEntries.forEach((entry, index) => {
    const sourceLink = document.createElement("a");
    sourceLink.className = "job-source-link-row";
    sourceLink.href = entry.link;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.innerHTML = `
      <span class="job-source-link-index">${index + 1}</span>
      <div class="job-source-link-copy">
        <strong>${entry.sourceName}</strong>
        <span>${entry.publicationLabel}</span>
      </div>
      <span class="job-source-link-open">Öppna</span>
    `;
    linksList.append(sourceLink);
  });

  const isBookmarked = state.bookmarks.has(job.id);
  bookmarkButton.textContent = !isSignedIn() ? "Logga in för att spara" : isBookmarked ? "Sparad" : "Spara";
  bookmarkButton.classList.toggle("is-bookmarked", isBookmarked);
  bookmarkButton.disabled = !isSignedIn();
  bookmarkButton.addEventListener("click", () => {
    if (!isSignedIn()) {
      return;
    }

    if (state.bookmarks.has(job.id)) {
      state.bookmarks.delete(job.id);
    } else {
      state.bookmarks.add(job.id);
    }

    persistState();
    render();
  });

  if (job.contacts.length) {
    job.contacts.forEach((contact) => contactsList.append(createContactCard(contact)));
  } else {
    const empty = document.createElement("p");
    empty.className = "job-contact-empty";
    empty.textContent =
      "Ingen chef eller kontaktperson kunde utläsas från annonsen eller närliggande kontaktsidor ännu.";
    contactsList.append(empty);
  }

  if (job.isDuplicate) {
    const note = document.createElement("span");
    note.className = "note-pill note-duplicate";
    note.textContent = `${job.duplicateCount} länkar sammanslagna till samma annons`;
    notes.append(note);
  }

  if (job.seenBefore) {
    const note = document.createElement("span");
    note.className = "note-pill note-seen";
    note.textContent = `Tidigare upptäckt ${formatTimestamp(job.firstSeenAt)} via ${job.firstSeenSource}`;
    notes.append(note);
  }

  if (job.timesSeenAcrossRefreshes > 1) {
    const note = document.createElement("span");
    note.className = "note-pill note-cycle";
    note.textContent = `Sedd i ${job.timesSeenAcrossRefreshes} uppdateringar`;
    notes.append(note);
  }

  const commuteButton = document.createElement("button");
  commuteButton.type = "button";
  commuteButton.className = "ghost-button";
  commuteButton.textContent = "Pendla hit";
  commuteButton.addEventListener("click", () => {
    setSelectedCommuteJob(job, { scrollIntoView: true });
  });

  actions.append(
    commuteButton,
    createStatusButton(job, "active", "Aktiv"),
    createStatusButton(job, "applied", "Sökt"),
    createStatusButton(job, "interview", "Intervju"),
    createStatusButton(job, "rejected", "Avböjt"),
    createStatusButton(job, "not_interested", "Ej intressant")
  );

  return fragment;
}

function updateBoardHeading(filteredJobs) {
  const currentTemplate = templates.find((template) => template.id === state.activeTemplate);
  const currentPipeline = pipelineViews.find((view) => view.id === state.activePipeline);
  const currentSort = sortOptions.find((option) => option.id === state.activeSort);

  elements.boardTitle.textContent = `${currentPipeline.label} · ${currentTemplate.label}`;
  elements.boardSubTitle.textContent = `${filteredJobs.length} sammanslagna annonser efter filter. Sortering: ${currentSort.label.toLowerCase()}. Rollen bedöms från annonsens titel och brödtext, och varje kort visar även firma, startinfo och chef- eller kontaktuppgifter när de har kunnat hittas.`;
}

function renderBoards() {
  const filteredJobs = getFilteredJobs();
  updateBoardHeading(filteredJobs);
  elements.categoryBoards.innerHTML = "";

  if (!filteredJobs.length) {
    elements.categoryBoards.innerHTML = `
      <div class="empty-state">
        Inga jobb matchar dina val just nu. Testa att byta mall, källa eller pipeline.
      </div>
    `;
    return;
  }

  categories.forEach((categoryName) => {
    const jobs = filteredJobs.filter((job) => job.category === categoryName);
    if (!jobs.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "category-section";

    const header = document.createElement("header");
    header.className = "category-section-head";
    header.innerHTML = `
      <div>
        <p class="section-kicker">Kategori</p>
        <h3>${categoryName}</h3>
      </div>
      <span>${jobs.length} annonser</span>
    `;

    const grid = document.createElement("div");
    grid.className = "job-grid";
    jobs.forEach((job) => grid.append(createJobCard(job)));

    section.append(header, grid);
    elements.categoryBoards.append(section);
  });
}

function updateRefreshStatus(messageOverride = null) {
  if (messageOverride) {
    elements.refreshStatus.textContent = messageOverride;
    return;
  }

  const lines = [`Senast uppdaterad: ${formatTimestamp(state.lastUpdated)}`];

  if (state.nextScheduledRefreshAt) {
    lines.push(`Nästa schemalagda GitHub-refresh: ${formatTimestamp(state.nextScheduledRefreshAt)}`);
  }

  lines.push("Knappen försöker live-refresh via server, annars laddas senaste publicerade GitHub-snapshot.");
  elements.refreshStatus.textContent = lines.join(" · ");
}

async function calculateCommute() {
  state.commuteOrigin = elements.commuteOriginInput?.value.trim() ?? "";
  state.commuteDestination = elements.commuteDestinationInput?.value.trim() ?? "";
  state.commuteDepartureAt = elements.commuteDepartureInput?.value || buildNextMondayEight();

  if (!state.commuteOrigin || !state.commuteDestination) {
    state.commuteResults = [];
    state.commuteStatusMessage = "Fyll i både startadress och destination innan du raknar pendlingen.";
    persistState();
    renderCommutePanel();
    return;
  }

  state.commuteStatusMessage = "Raknar pendling och bygger Google Maps-lankar...";
  renderCommutePanel();

  try {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      throw new Error("GitHub Pages fallback");
    }

    const response = await fetch("./api/commute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        origin: state.commuteOrigin,
        destination: state.commuteDestination,
        departureAt: state.commuteDepartureAt,
      }),
    });

    if (!response.ok) {
      throw new Error(`API-fel ${response.status}`);
    }

    const payload = await response.json();
    state.commuteResults = payload.results ?? [];
    state.commuteStatusMessage =
      payload.message ??
      "Restider hamtade. Jamfor alternativen och oppna sedan den rutt som passar dig bast.";
  } catch {
    state.commuteResults = buildFallbackCommuteResults(state.commuteOrigin, state.commuteDestination);
    state.commuteStatusMessage =
      "Google Maps-lankar ar klara. Exakta restider kraver server med Google Maps-nyckel; annars beraknas de nar du oppnar lanken.";
  }

  persistState();
  renderCommutePanel();
}

async function readStaticSnapshot() {
  const response = await fetch(`${dataUrl}?ts=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kunde inte läsa ${dataUrl}`);
  }

  return response.json();
}

async function readLivePayload({ manual = false } = {}) {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("Ingen lokal server");
  }

  const response = await fetch(manual ? "./api/refresh" : "./api/jobs", {
    method: manual ? "POST" : "GET",
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API-fel ${response.status}`);
  }

  return response.json();
}

function splitIntoSentences(value = "") {
  return String(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractFirstMeaningfulLine(value = "") {
  return String(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 12) || "Annonsen";
}

function inferGeneratorRole(adText = "") {
  const normalized = normalizeLookup(adText);

  if (/specialist|overlakare|allmanspecialist|specialist i|specialist inom/.test(normalized)) {
    return "specialistläkare";
  }

  if (/bt lakare|bastjanstgoring|bastjanstgoringslakare/.test(normalized)) {
    return "BT-läkare";
  }

  if (/underlakare|lakarkandidat|at lakare/.test(normalized)) {
    return "underläkare";
  }

  if (/legitimerad lakare|leg lakare|distriktslakare/.test(normalized)) {
    return "legitimerad läkare";
  }

  return "läkare";
}

function inferOrganization(adText = "") {
  const firstLine = extractFirstMeaningfulLine(adText);
  const inlineMatch = firstLine.match(/(?:hos|på|till)\s+([A-ZÅÄÖa-zåäö0-9&.\- ]{3,70})/);
  if (inlineMatch) {
    return inlineMatch[1].trim();
  }

  const orgMatch = adText.match(
    /\b(?:Capio|Meliva|Kry|Praktikertjänst|Region Stockholm|Södersjukhuset|Karolinska|SLSO|Danderyds Sjukhus|Internetmedicin)\b/i
  );

  return orgMatch ? orgMatch[0] : "er verksamhet";
}

function inferProfileHighlights(profileText = "") {
  const lines = String(profileText)
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 8);

  return lines.slice(0, 4);
}

function generateLetterFromInputs(adText, profileText) {
  const trimmedAd = adText.trim();
  const trimmedProfile = profileText.trim();

  if (!trimmedAd || !trimmedProfile) {
    return {
      letter: "",
      status: "Fyll i både annonsens brödtext och ditt CV eller LinkedIn-underlag först.",
    };
  }

  const adTitle = extractFirstMeaningfulLine(trimmedAd);
  const organization = inferOrganization(trimmedAd);
  const role = inferGeneratorRole(trimmedAd);
  const adSignals = splitIntoSentences(trimmedAd).slice(0, 3);
  const profileHighlights = inferProfileHighlights(trimmedProfile);

  const opening =
    `Hej,\n\nJag vill gärna anmäla mitt intresse för tjänsten "${adTitle}" hos ${organization}. ` +
    `Utifrån annonsen bedömer jag att ni söker en ${role} med god klinisk förmåga, samarbetsförmåga och ett tydligt patientfokus.`;

  const adParagraph = adSignals.length
    ? `\n\nDet som särskilt tilltalar mig i annonsen är ${adSignals.join(" ").trim()}`
    : "";

  const profileParagraph = profileHighlights.length
    ? `\n\nI min profil vill jag särskilt lyfta fram ${profileHighlights
        .map((line, index) => (index === 0 ? line.charAt(0).toLowerCase() + line.slice(1) : line))
        .join(", ")}. Jag trivs i miljöer där ansvar, tempo och gott samarbete behöver kombineras med ett lugnt och professionellt bemötande.`
    : "\n\nJag bidrar med en stabil medicinsk grund, hög arbetskapacitet och ett starkt engagemang för patientsäkerhet, bemötande och teamarbete.";

  const closing =
    "\n\nJag skulle uppskatta möjligheten att berätta mer om hur jag kan bidra till verksamheten och utvecklas vidare tillsammans med er. Tack för att ni tar er tid att läsa min ansökan.\n\nVänliga hälsningar";

  return {
    letter: `${opening}${adParagraph}${profileParagraph}${closing}`.trim(),
    status: `Brevutkast skapat för ${role} hos ${organization}. Justera gärna tonen och detaljerna innan du skickar.`,
  };
}

function render() {
  renderAccountPanel();
  renderTemplates();
  renderPipelineTabs();
  renderCategoryFilters();
  renderAgeFilters();
  renderSourceList();
  renderSummary();
  renderBoards();
  renderCommutePanel();
  updateRefreshStatus();

  if (elements.sortSelect) {
    elements.sortSelect.value = state.activeSort;
  }
}

async function loadJobs({ manual = false } = {}) {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = manual ? "Hämtar..." : "Uppdaterar...";

  try {
    let payload;

    try {
      payload = await readLivePayload({ manual });
    } catch {
      payload = await readStaticSnapshot();
    }

    state.jobs = payload.jobs ?? [];
    state.sourceSummaries = payload.sourceSummaries ?? [];
    state.stats = payload.stats ?? {};
    state.lastUpdated = payload.lastUpdated ?? null;
    state.nextScheduledRefreshAt = payload.nextScheduledRefreshAt ?? null;

    render();
  } catch (error) {
    updateRefreshStatus(`Kunde inte läsa GitHub-datan: ${error.message}`);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "Hämta senaste jobb";
  }
}

elements.refreshButton.addEventListener("click", () => {
  loadJobs({ manual: true });
});

elements.clearFiltersButton.addEventListener("click", () => {
  state.activePipeline = "all";
  state.activeAgeFilter = "all";
  state.activeSort = "earliest";
  state.activeCategories = new Set(categories);
  state.activeSources = new Set();
  state.searchQuery = "";
  elements.searchInput.value = "";
  persistState();
  render();
});

elements.searchInput.addEventListener("input", (event) => {
  state.searchQuery = event.target.value.trim();
  render();
});

elements.sortSelect?.addEventListener("change", (event) => {
  state.activeSort = event.target.value;
  persistState();
  render();
});

function submitAccountFromInput({ create = false } = {}) {
  const candidate = elements.accountInput?.value ?? "";
  if (!looksLikeEmail(candidate)) {
    if (elements.accountHint) {
      elements.accountHint.textContent = "Skriv en giltig e-postadress for att skapa eller logga in pa kontot.";
    }
    return false;
  }

  setActiveAccount(candidate);
  const account = getActiveAccountProfile();
  if (create && account) {
    account.name = candidate.trim().toLowerCase();
    account.notificationSettings.statusMessage =
      "Kontot ar skapat. Du kan nu spara jobbstatus och aktivera e-postnotiser for just den har adressen.";
  }
  persistState();
  render();
  syncNotificationSettings();
  return true;
}

elements.createAccountButton?.addEventListener("click", () => {
  submitAccountFromInput({ create: true });
});

elements.loginButton?.addEventListener("click", () => {
  submitAccountFromInput();
});

elements.accountInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.loginButton?.click();
  }
});

elements.signoutButton?.addEventListener("click", () => {
  setActiveAccount("");
  persistState();
  render();
});

elements.notificationToggle?.addEventListener("change", (event) => {
  updateNotificationSetting((settings) => {
    settings.enabled = event.target.checked;
  });
});

elements.notificationFrequencySelect?.addEventListener("change", (event) => {
  updateNotificationSetting((settings) => {
    settings.frequencyHours = Number(event.target.value);
  });
});

elements.generateLetterButton?.addEventListener("click", () => {
  const result = generateLetterFromInputs(
    elements.generatorAdInput?.value ?? "",
    elements.generatorProfileInput?.value ?? ""
  );

  if (elements.generatorLetterOutput) {
    elements.generatorLetterOutput.value = result.letter;
  }

  if (elements.generatorStatus) {
    elements.generatorStatus.textContent = result.status;
  }
});

elements.copyLetterButton?.addEventListener("click", async () => {
  const letter = elements.generatorLetterOutput?.value ?? "";
  if (!letter.trim()) {
    if (elements.generatorStatus) {
      elements.generatorStatus.textContent = "Skapa ett brevutkast först, sedan kan du kopiera det.";
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(letter);
    if (elements.generatorStatus) {
      elements.generatorStatus.textContent = "Personligt brev kopierat till urklipp.";
    }
  } catch {
    if (elements.generatorStatus) {
      elements.generatorStatus.textContent =
        "Kunde inte kopiera automatiskt. Markera brevet manuellt och kopiera det.";
    }
  }
});

elements.useLocationButton?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    state.commuteStatusMessage = "Din webblasare stoder inte automatisk platsdelning.";
    renderCommutePanel();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.commuteOrigin = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
      if (elements.commuteOriginInput) {
        elements.commuteOriginInput.value = state.commuteOrigin;
      }
      state.commuteStatusMessage = "Din nuvarande plats ar ifylld som koordinater. Du kan justera adressen manuellt om du vill.";
      persistState();
      renderCommutePanel();
    },
    () => {
      state.commuteStatusMessage = "Kunde inte hamta din plats. Skriv in adressen manuellt i stallet.";
      renderCommutePanel();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5 * 60 * 1000,
      timeout: 15000,
    }
  );
});

elements.calculateCommuteButton?.addEventListener("click", () => {
  calculateCommute();
});

elements.commuteOriginInput?.addEventListener("input", (event) => {
  state.commuteOrigin = event.target.value;
  persistState();
});

elements.commuteDestinationInput?.addEventListener("input", (event) => {
  state.commuteDestination = event.target.value;
  persistState();
});

elements.commuteDepartureInput?.addEventListener("change", (event) => {
  state.commuteDepartureAt = event.target.value;
  persistState();
});

loadStoredState();
render();
await loadJobs();

window.setInterval(() => {
  loadJobs();
}, 30 * 60 * 1000);
