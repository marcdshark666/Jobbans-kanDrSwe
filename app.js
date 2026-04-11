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

const storageKey = "doctor-jobs-radar-v2";

const state = {
  jobs: [],
  sourceSummaries: [],
  stats: {},
  lastUpdated: null,
  nextScheduledRefreshAt: null,
  activeTemplate: "stockholm",
  activePipeline: "all",
  activeAgeFilter: "all",
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
  heroLiveCount: document.querySelector("#heroLiveCount"),
  heroSourceCount: document.querySelector("#heroSourceCount"),
  heroNextRefresh: document.querySelector("#heroNextRefresh"),
  jobCardTemplate: document.querySelector("#jobCardTemplate"),
};

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
      activeCategories: Array.from(state.activeCategories),
      activeSources: Array.from(state.activeSources),
    })
  );
}

function formatTimestamp(value) {
  if (!value) {
    return "Ingen uppdatering ännu";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPublishedAt(value) {
  if (!value) {
    return "Ej angivet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
  }).format(date);
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

  const haystack = [job.title, job.location, job.sourceName, job.category]
    .join(" ")
    .toLowerCase();

  return haystack.includes(state.searchQuery.toLowerCase());
}

function matchesSourceFilter(job) {
  return state.activeSources.size === 0 ? true : state.activeSources.has(job.sourceId);
}

function getJobReferenceDate(job) {
  const candidates = [job.publishedAt, job.detectedAt, job.firstSeenAt];
  const now = Date.now();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    if (parsed.getTime() > now + 24 * 60 * 60 * 1000) {
      continue;
    }

    if (parsed.getTime() <= now) {
      return parsed;
    }
  }

  return null;
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

function getFilteredJobs() {
  return state.jobs.filter(
    (job) =>
      state.activeCategories.has(job.category) &&
      matchesTemplate(job) &&
      matchesPipeline(job) &&
      matchesSearch(job) &&
      matchesAgeFilter(job) &&
      matchesSourceFilter(job)
  );
}

function getStatusCounts() {
  const counts = {
    active: 0,
    bookmarks: 0,
    applied: 0,
    interview: 0,
    rejected: 0,
  };

  state.jobs.forEach((job) => {
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
  return state.jobs.filter(
    (job) =>
      matchesTemplate(job) &&
      matchesSearch(job) &&
      matchesAgeFilter(job) &&
      matchesSourceFilter(job)
  );
}

function getJobsForSourceCounts() {
  return state.jobs.filter((job) => matchesTemplate(job) && matchesSearch(job) && matchesAgeFilter(job));
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
    counts[job.sourceId] = (counts[job.sourceId] ?? 0) + 1;
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
  const statusCounts = getStatusCounts();
  const summaryItems = [
    ["Live jobb", state.stats.totalJobs ?? state.jobs.length ?? 0],
    ["Stockholm", state.stats.stockholmJobs ?? 0],
    ["Hela Sverige", state.stats.sverigeJobs ?? 0],
    ["Möjliga dubbletter", state.stats.duplicateJobs ?? 0],
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

  elements.heroLiveCount.textContent = `${state.stats.totalJobs ?? state.jobs.length ?? 0} jobb`;
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
  const notes = fragment.querySelector(".job-notes");
  const actions = fragment.querySelector(".job-actions");

  category.textContent = job.category;
  title.textContent = job.title;
  location.textContent = job.location;
  source.textContent = job.sourceName;
  published.textContent = formatPublishedAt(job.publishedAt);
  link.href = job.link;

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

  if (job.isDuplicate && job.duplicateSources.length) {
    const note = document.createElement("span");
    note.className = "note-pill note-duplicate";
    note.textContent = `Möjlig dubblett även hos ${job.duplicateSources.join(", ")}`;
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
  const currentAgeFilter = ageFilters.find((filter) => filter.id === state.activeAgeFilter);

  elements.boardTitle.textContent = `${currentPipeline.label} · ${currentTemplate.label}`;
  elements.boardSubTitle.textContent = `${filteredJobs.length} matchningar efter filter, status, datum och källor (${currentAgeFilter.label.toLowerCase()}).`;
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

loadStoredState();
render();
await loadJobs();

window.setInterval(() => {
  loadJobs();
}, 30 * 60 * 1000);
