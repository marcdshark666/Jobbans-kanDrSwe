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
    id: "hela-sverige",
    label: "Hela Sverige",
    description: "Visar alla relevanta läkarjobb i hela Sverige.",
  },
];

const categories = [
  "Underläkare",
  "BT-läkare",
  "Legitimerad läkare",
  "Specialist",
];

const pipelineViews = [
  { id: "all", label: "Aktiva" },
  { id: "bookmarks", label: "Bokmärken" },
  { id: "applied", label: "Sökt" },
  { id: "interview", label: "Intervju" },
  { id: "rejected", label: "Avböjt" },
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

const storageKey = "doctor-jobs-radar-v3";
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
};

const elements = {
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

function loadStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (!parsed) {
      return;
    }

    state.bookmarks = new Set(parsed.bookmarks ?? []);
    state.statuses = parsed.statuses ?? {};
    state.activeTemplate = parsed.activeTemplate ?? state.activeTemplate;
    state.activePipeline = parsed.activePipeline ?? state.activePipeline;
    state.activeAgeFilter = parsed.activeAgeFilter ?? state.activeAgeFilter;
    state.activeSort = parsed.activeSort ?? state.activeSort;

    const restoredCategories = (parsed.activeCategories ?? []).filter((item) =>
      categories.includes(item)
    );
    if (restoredCategories.length) {
      state.activeCategories = new Set(restoredCategories);
    }

    state.activeSources = new Set(parsed.activeSources ?? []);
  } catch (error) {
    console.warn("Kunde inte läsa sparat tillstånd", error);
  }
}

function persistState() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      bookmarks: Array.from(state.bookmarks),
      statuses: state.statuses,
      activeTemplate: state.activeTemplate,
      activePipeline: state.activePipeline,
      activeAgeFilter: state.activeAgeFilter,
      activeSort: state.activeSort,
      activeCategories: Array.from(state.activeCategories),
      activeSources: Array.from(state.activeSources),
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
  const oldestPublicationDate = sourceEntries.find((entry) => entry.referenceDate)?.referenceDate ?? null;
  const latestPublicationDate = [...sourceEntries].reverse().find((entry) => entry.referenceDate)?.referenceDate ?? null;
  const firstSeenAt =
    groupJobs
      .map((job) => toDate(job.firstSeenAt))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const timesSeenAcrossRefreshes = Math.max(...groupJobs.map((job) => job.timesSeenAcrossRefreshes ?? 1), 1);
  const location = pickBestLocation(groupJobs, sourceEntries);

  return {
    id: `group:${groupKey}`,
    groupKey,
    title: primaryEntry?.title ?? groupJobs[0]?.title ?? "Okänd annons",
    category: groupJobs[0]?.category ?? "Legitimerad läkare",
    location,
    stockholmMatch: groupJobs.some((job) => job.stockholmMatch),
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
    firstSeenSource:
      groupJobs.find((job) => job.firstSeenSource)?.firstSeenSource ?? sourceNames[0] ?? "Okänd källa",
    timesSeenAcrossRefreshes,
    searchText: [primaryEntry?.title ?? "", location, groupJobs[0]?.category ?? "", ...sourceNames]
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
  return state.activeTemplate === "hela-sverige" ? true : job.stockholmMatch;
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

function renderSummary() {
  const groupedJobs = getGroupedJobs();
  const statusCounts = getStatusCounts();
  const summaryItems = [
    ["Live annonser", groupedJobs.length],
    ["Stockholm", groupedJobs.filter((job) => job.stockholmMatch).length],
    ["Hela Sverige", groupedJobs.filter((job) => !job.stockholmMatch).length],
    ["Sammanslagna dubletter", groupedJobs.filter((job) => job.isDuplicate).length],
    ["Bokmärken", statusCounts.bookmarks],
    ["Sökt", statusCounts.applied],
    ["Intervju", statusCounts.interview],
    ["Avböjt", statusCounts.rejected],
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

function createStatusButton(job, statusId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `status-chip ${getPipelineStatus(job.id) === statusId ? "is-status-active" : ""}`;
  button.dataset.status = statusId;
  button.textContent = label;
  button.addEventListener("click", () => {
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
  const source = fragment.querySelector(".job-source");
  const published = fragment.querySelector(".job-published");
  const link = fragment.querySelector(".job-link");
  const linkCount = fragment.querySelector(".job-link-count");
  const linksList = fragment.querySelector(".job-links-list");
  const notes = fragment.querySelector(".job-notes");
  const actions = fragment.querySelector(".job-actions");

  category.textContent = job.category;
  title.innerHTML = `<a class="job-title-link" href="${job.link}" target="_blank" rel="noreferrer">${job.title}</a>`;
  location.textContent = job.location;
  source.textContent =
    job.sourceEntries.length === 1 ? job.sourceEntries[0].sourceName : `${job.sourceEntries.length} källor`;
  published.textContent = job.oldestPublicationLabel;
  link.href = job.link;
  link.textContent = "Öppna första träffen";
  linkCount.textContent = `${job.sourceEntries.length} länk${job.sourceEntries.length === 1 ? "" : "ar"}`;

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
  bookmarkButton.textContent = isBookmarked ? "Sparad" : "Spara";
  bookmarkButton.classList.toggle("is-bookmarked", isBookmarked);
  bookmarkButton.addEventListener("click", () => {
    if (state.bookmarks.has(job.id)) {
      state.bookmarks.delete(job.id);
    } else {
      state.bookmarks.add(job.id);
    }

    persistState();
    render();
  });

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

  actions.append(
    createStatusButton(job, "active", "Aktiv"),
    createStatusButton(job, "applied", "Sökt"),
    createStatusButton(job, "interview", "Intervju"),
    createStatusButton(job, "rejected", "Avböjt")
  );

  return fragment;
}

function updateBoardHeading(filteredJobs) {
  const currentTemplate = templates.find((template) => template.id === state.activeTemplate);
  const currentPipeline = pipelineViews.find((view) => view.id === state.activePipeline);
  const currentSort = sortOptions.find((option) => option.id === state.activeSort);

  elements.boardTitle.textContent = `${currentPipeline.label} · ${currentTemplate.label}`;
  elements.boardSubTitle.textContent = `${filteredJobs.length} sammanslagna annonser efter filter. Sortering: ${currentSort.label.toLowerCase()}. Datumet i varje länkrad visar när respektive källa publicerade annonsen.`;
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

function render() {
  renderTemplates();
  renderPipelineTabs();
  renderCategoryFilters();
  renderAgeFilters();
  renderSourceList();
  renderSummary();
  renderBoards();
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

loadStoredState();
render();
await loadJobs();

window.setInterval(() => {
  loadJobs();
}, 30 * 60 * 1000);
