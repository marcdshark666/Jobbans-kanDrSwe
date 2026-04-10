/* ============================================================
   LäkarJobb Portal — Frontend Application
   ============================================================ */

const CATEGORY_LABELS = {
  underlakar:  { label: 'Underläkare', icon: '👨‍⚕️' },
  bt:          { label: 'BT-läkare',   icon: '🩺' },
  legitimerad: { label: 'Legitimerad', icon: '📋' },
  specialist:  { label: 'Specialist',  icon: '⭐' },
  other:       { label: 'Övrigt',      icon: '📌' },
};

const VIEW_LABELS = {
  all:       { title: 'Alla jobb',  subtitle: 'Uppdateras automatiskt var 30:e minut' },
  favorites: { title: '⭐ Bokmärken',  subtitle: 'Dina sparade annonser' },
  applied:   { title: '📨 Sökt',    subtitle: 'Ansökningar du skickat' },
  interview: { title: '🎯 Intervju', subtitle: 'Inbjudna till intervju' },
  rejected:  { title: '❌ Avböjt',  subtitle: 'Annonser du fått avslag från' },
};

// ============================================================
// STATE
// ============================================================
let state = {
  allJobs: [],
  lastUpdated: null,
  sources: [],
  layout: 'grid',         // 'grid' | 'list'
  currentView: 'all',     // 'all' | 'favorites' | 'applied' | 'interview' | 'rejected'
  currentCat: 'all',
  currentRegion: 'all',
  activeSources: new Set(),
  searchQuery: '',
  // Per-job user data (stored in localStorage)
  userData: {},
};

// ============================================================
// LOCALSTORAGE
// ============================================================
function loadUserData() {
  try {
    const raw = localStorage.getItem('lakarjobb_userData');
    if (raw) state.userData = JSON.parse(raw);
  } catch (e) { state.userData = {}; }
}

function saveUserData() {
  try { localStorage.setItem('lakarjobb_userData', JSON.stringify(state.userData)); } catch (e) {}
}

function getJobData(id) {
  return state.userData[id] || { favorite: false, status: null }; // status: null | 'applied' | 'interview' | 'rejected'
}

function setJobData(id, patch) {
  state.userData[id] = { ...getJobData(id), ...patch };
  saveUserData();
  renderJobs();
  updateCounts();
}

// ============================================================
// FETCH JOBS
// ============================================================
async function loadJobs(isManualRefresh = false) {
  setStatus('loading', 'Hämtar jobb...');
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('jobGrid').innerHTML = '';

  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.classList.add('spinning');
  refreshBtn.disabled = true;

  try {
    let endpoint = '/api/jobs';
    if (isManualRefresh) endpoint = '/api/refresh';

    let data;
    if (isManualRefresh) {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) throw new Error('Server svarade ' + res.status);
      // After refresh, fetch updated data
      const res2 = await fetch('/api/jobs');
      data = await res2.json();
    } else {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Server svarade ' + res.status);
      data = await res.json();
    }

    state.allJobs = data.jobs || [];
    state.lastUpdated = data.lastUpdated;
    state.sources = data.sources || [];
    state.activeSources = new Set(state.sources);

    setStatus('online', `${state.allJobs.length} annonser live`, state.allJobs.length);
    renderSourceFilter();
    renderJobs();
    updateCounts();
    updateLastUpdated();
    showToast(`✅ ${state.allJobs.length} jobb laddade från ${state.sources.length} källor`);
  } catch (e) {
    // Load from static file as fallback (for GitHub Pages)
    try {
      const res = await fetch('./data/jobs-cache.json');
      if (res.ok) {
        const data = await res.json();
        state.allJobs = data.jobs || [];
        state.lastUpdated = data.lastUpdated;
        state.sources = data.sources || [];
        state.activeSources = new Set(state.sources);
        setStatus('online', `${state.allJobs.length} (cache)`, state.allJobs.length);
        renderSourceFilter();
        renderJobs();
        updateCounts();
        updateLastUpdated();
        showToast(`📦 ${state.allJobs.length} jobb från cache`);
        return;
      }
    } catch (e2) {}

    // Final fallback: demo jobs
    state.allJobs = getDemoJobs();
    state.sources = [...new Set(state.allJobs.map(j => j.source))];
    state.activeSources = new Set(state.sources);
    setStatus('error', 'Offline — visar demo');
    renderSourceFilter();
    renderJobs();
    updateCounts();
    showToast('⚠️ Offline – visar exempeljobb. Starta servern för live-data.', 5000);
  } finally {
    document.getElementById('loadingState').style.display = 'none';
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

function getDemoJobs() {
  return [
    { id:'demo1', title:'Underläkare', location:'Karolinska Universitetssjukhuset, Stockholm', source:'Karolinska', sourceUrl:'https://karolinska.se/', link:'https://karolinska.se/jobba-hos-oss/', category:'underlakar', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo2', title:'BT-läkare bastjänstgöring', location:'Södersjukhuset, Stockholm', source:'Södersjukhuset', sourceUrl:'https://sodersjukhuset.se/', link:'https://www.sodersjukhuset.se/jobb-och-karriar/', category:'bt', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo3', title:'Specialistläkare allmänmedicin', location:'Capio Citykliniken, Stockholm', source:'Capio', sourceUrl:'https://capio.se/', link:'https://capio.se/jobba-hos-oss/', category:'specialist', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo4', title:'Legitimerad läkare, vikariat', location:'Praktikertjänst, Göteborg', source:'Praktikertjänst', sourceUrl:'https://praktikertjanst.se/', link:'https://www.praktikertjanst.se/lediga-tjanster/', category:'legitimerad', inStockholm:false, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo5', title:'Distriktsläkare', location:'Stockholm / Remote', source:'Kry', sourceUrl:'https://kry.se/', link:'https://careers.kry.se/', category:'legitimerad', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo6', title:'Underläkare, sommarvikariat', location:'Norrtälje Sjukhus', source:'Region Stockholm', sourceUrl:'https://regionstockholm.se/', link:'https://www.regionstockholm.se/jobb-och-karriar/', category:'underlakar', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo7', title:'Specialistläkare psykiatri', location:'Uppsala', source:'Jobtech/Platsbanken', sourceUrl:'https://arbetsformedlingen.se/', link:'https://arbetsformedlingen.se/platsbanken/', category:'specialist', inStockholm:false, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo8', title:'AT-läkare', location:'Danderyds sjukhus, Stockholm', source:'Vakanser.se', sourceUrl:'https://vakanser.se/', link:'https://www.vakanser.se/', category:'underlakar', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo9', title:'Legitimerad läkare', location:'Stockholm', source:'Meliva', sourceUrl:'https://meliva.se/', link:'https://meliva.se/lediga-tjanster/', category:'legitimerad', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo10', title:'BT-läkare, vikariat 3 mån', location:'Huddinge, Stockholm', source:'SLSO', sourceUrl:'https://slso.sll.se/', link:'https://www.slso.sll.se/sv/om-slso/jobba-hos-oss/', category:'bt', inStockholm:true, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo11', title:'Specialistläkare kardiologi', location:'Lund', source:'Varbi.se', sourceUrl:'https://varbi.com/', link:'https://varbi.com/', category:'specialist', inStockholm:false, fetchedAt:new Date().toISOString(), duplicateOf:null },
    { id:'demo12', title:'Underläkare, akutklinik', location:'Örebro', source:'LinkedIn', sourceUrl:'https://linkedin.com/jobs/', link:'https://linkedin.com/jobs/', category:'underlakar', inStockholm:false, fetchedAt:new Date().toISOString(), duplicateOf:null },
  ];
}

// ============================================================
// FILTERS & VIEWS
// ============================================================
function getFilteredJobs() {
  let jobs = state.allJobs;
  const q = state.searchQuery.toLowerCase().trim();

  return jobs.filter(job => {
    // View filter
    const ud = getJobData(job.id);
    if (state.currentView === 'favorites') return ud.favorite;
    if (state.currentView === 'applied')   return ud.status === 'applied';
    if (state.currentView === 'interview') return ud.status === 'interview';
    if (state.currentView === 'rejected')  return ud.status === 'rejected';

    // Category
    if (state.currentCat !== 'all' && job.category !== state.currentCat) return false;
    // Region
    if (state.currentRegion === 'stockholm' && !job.inStockholm) return false;
    // Source
    if (state.activeSources.size > 0 && !state.activeSources.has(job.source)) return false;
    // Search
    if (q) {
      const haystack = `${job.title} ${job.location} ${job.source}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function setCategory(el, cat) {
  state.currentCat = cat;
  state.currentView = 'all';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  updateViewHeader();
  filterJobs();
}

function setRegion(el, region) {
  state.currentRegion = region;
  document.querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterJobs();
}

function setView(el, view) {
  state.currentView = view;
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.cat-btn[data-cat="all"]').classList.add('active');
  state.currentCat = 'all';
  updateViewHeader();
  filterJobs();
}

function setLayout(layout) {
  state.layout = layout;
  document.getElementById('viewGrid').classList.toggle('active', layout === 'grid');
  document.getElementById('viewList').classList.toggle('active', layout === 'list');
  document.getElementById('jobGrid').classList.toggle('list-layout', layout === 'list');
}

function filterJobs() {
  state.searchQuery = document.getElementById('searchInput').value;
  renderJobs();
  updateCounts();
}

function updateViewHeader() {
  const key = state.currentView;
  const info = VIEW_LABELS[key] || VIEW_LABELS.all;
  document.getElementById('viewTitle').textContent = info.title;
  document.getElementById('viewSubtitle').textContent = info.subtitle;
}

// ============================================================
// RENDER JOBS
// ============================================================
function renderJobs() {
  const grid = document.getElementById('jobGrid');
  const filtered = getFilteredJobs();

  if (filtered.length === 0) {
    grid.innerHTML = '';
    document.getElementById('emptyState').style.display = 'block';
    return;
  }
  document.getElementById('emptyState').style.display = 'none';

  grid.innerHTML = filtered.map((job, i) => renderJobCard(job, i)).join('');
}

function renderJobCard(job, i) {
  const ud = getJobData(job.id);
  const cat = CATEGORY_LABELS[job.category] || CATEGORY_LABELS.other;
  const delay = Math.min(i * 0.04, 0.5);

  // Duplicate warning
  const dupTag = job.duplicateOf
    ? `<span class="meta-tag tag-duplicate" title="Annons också publierad på ${job.duplicateOf}">⚠️ Dubblett: ${escHtml(job.duplicateOf)}</span>`
    : '';

  const deadlineTag = job.deadline
    ? `<span class="meta-tag tag-deadline">📅 ${escHtml(job.deadline)}</span>`
    : '';

  const demoTag = job.isDemo
    ? `<span class="meta-tag tag-demo">Demo</span>`
    : '';

  const srcUrl = job.sourceUrl || job.link || '#';

  return `
  <div class="job-card"
       data-cat="${escHtml(job.category || 'other')}"
       data-id="${escHtml(job.id)}"
       style="animation-delay:${delay}s">
    <div class="card-header">
      <div class="card-body-left">
        <div class="card-title">${escHtml(job.title)}</div>
      </div>
      <div class="card-actions-top">
        <button class="icon-btn ${ud.favorite ? 'fav-active' : ''}"
                title="${ud.favorite ? 'Ta bort från bokmärken' : 'Spara som bokmärke'}"
                onclick="toggleFav('${escHtml(job.id)}')">
          ${ud.favorite ? '⭐' : '☆'}
        </button>
      </div>
    </div>

    <div class="card-meta">
      <span class="meta-tag tag-source" title="Källa: ${escHtml(job.source)}">🔗 ${escHtml(job.source)}</span>
      <span class="meta-tag tag-location">📍 ${escHtml(job.location || 'Sverige')}</span>
      <span class="meta-tag tag-cat">${cat.icon} ${cat.label}</span>
      ${deadlineTag}
      ${dupTag}
      ${demoTag}
    </div>

    <div class="card-status-row">
      <button class="status-action-btn s-applied ${ud.status === 'applied' ? 'active' : ''}"
              onclick="setStatus_('${escHtml(job.id)}','applied')">
        📨 Sökt
      </button>
      <button class="status-action-btn s-interview ${ud.status === 'interview' ? 'active' : ''}"
              onclick="setStatus_('${escHtml(job.id)}','interview')">
        🎯 Intervju
      </button>
      <button class="status-action-btn s-rejected ${ud.status === 'rejected' ? 'active' : ''}"
              onclick="setStatus_('${escHtml(job.id)}','rejected')">
        ❌ Avböjt
      </button>
    </div>

    <div class="card-link-row">
      <a class="btn-apply" href="${escHtml(job.link || '#')}" target="_blank" rel="noopener">
        Ansök / Öppna
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </a>
      <a class="btn-source" href="${escHtml(srcUrl)}" target="_blank" rel="noopener" title="Gå till källan">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </a>
    </div>
  </div>`;
}

// ============================================================
// USER ACTIONS
// ============================================================
function toggleFav(id) {
  const ud = getJobData(id);
  setJobData(id, { favorite: !ud.favorite });
  showToast(ud.favorite ? '☆ Borttaget från bokmärken' : '⭐ Sparat till bokmärken');
}

function setStatus_(id, status) {
  const ud = getJobData(id);
  const newStatus = ud.status === status ? null : status; // toggle
  setJobData(id, { status: newStatus });
  const labels = { applied: '📨 Markerad som Sökt', interview: '🎯 Markerad som Intervju', rejected: '❌ Markerad som Avböjt' };
  if (newStatus) showToast(labels[newStatus]);
  else showToast('Statusmarkering borttagen');
}

// ============================================================
// SOURCE FILTER RENDER
// ============================================================
function renderSourceFilter() {
  const container = document.getElementById('sourceList');
  const sourceCounts = {};
  state.allJobs.forEach(j => { sourceCounts[j.source] = (sourceCounts[j.source] || 0) + 1; });

  container.innerHTML = state.sources.map(src => `
    <label class="source-item ${state.activeSources.has(src) ? 'active' : ''}">
      <input type="checkbox" ${state.activeSources.has(src) ? 'checked' : ''} onchange="toggleSource('${escHtml(src)}')" />
      <span class="source-item-name">${escHtml(src)}</span>
      <span class="source-item-count">${sourceCounts[src] || 0}</span>
    </label>
  `).join('');
}

function toggleSource(src) {
  if (state.activeSources.has(src)) state.activeSources.delete(src);
  else state.activeSources.add(src);
  filterJobs();
}

// ============================================================
// COUNTS
// ============================================================
function updateCounts() {
  const counts = { all: 0, underlakar: 0, bt: 0, legitimerad: 0, specialist: 0, other: 0 };
  const statusCounts = { favorites: 0, applied: 0, interview: 0, rejected: 0 };

  state.allJobs.forEach(job => {
    const ud = getJobData(job.id);
    counts.all++;
    counts[job.category] = (counts[job.category] || 0) + 1;
    if (ud.favorite) statusCounts.favorites++;
    if (ud.status === 'applied') statusCounts.applied++;
    if (ud.status === 'interview') statusCounts.interview++;
    if (ud.status === 'rejected') statusCounts.rejected++;
  });

  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`cnt-${k}`);
    if (el) el.textContent = v;
  });
  Object.entries(statusCounts).forEach(([k, v]) => {
    const el = document.getElementById(`cnt-${k}`);
    if (el) el.textContent = v;
  });
}

// ============================================================
// STATUS BAR
// ============================================================
function setStatus(type, text, count) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const cnt = document.getElementById('statusCount');
  dot.className = 'status-dot ' + type;
  txt.textContent = text;
  if (count != null) {
    cnt.textContent = count + ' jobb';
    cnt.style.display = '';
  }
}

// ============================================================
// REFRESH
// ============================================================
function refreshJobs() { loadJobs(true); }

// ============================================================
// LAST UPDATED
// ============================================================
function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!state.lastUpdated) { el.textContent = ''; return; }
  const d = new Date(state.lastUpdated);
  el.textContent = `Senast uppdaterad: ${d.toLocaleString('sv-SE')} — ${state.sources.length} källor`;
}

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ============================================================
// HELPERS
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// INIT
// ============================================================
function init() {
  loadUserData();
  updateViewHeader();
  loadJobs(false);

  // Auto-refresh every 30 minutes
  setInterval(() => {
    loadJobs(false);
  }, 30 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
