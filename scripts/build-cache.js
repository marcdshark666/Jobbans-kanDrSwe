// ============================================================
// Läkarjobb Cache Builder - samlar jobb från 12+ källor
// ============================================================
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'jobs-cache.json');

// --- Hjälpfunktioner ---
function normalizeTitle(title) {
  return (title || '').toLowerCase().trim();
}

function detectCategory(title) {
  const t = normalizeTitle(title);
  if (t.includes('specialistläk') || t.includes('specialist') || t.includes('överläk') || t.includes('konsultläk')) return 'specialist';
  if (t.includes('bt-läk') || t.includes('bastjänstgör') || t.includes(' bt ') || t.includes('bt-') || t.includes('btläk')) return 'bt';
  if (t.includes('underläk') || t.includes('läkarvikar') || t.includes('vikarie') || t.includes('at-läk') || t.includes('at ')) return 'underlakar';
  if (t.includes('legitimerad') || t.includes('leg. läk') || t.includes('distriktsläk') || t.includes('allmänläk')) return 'legitimerad';
  if (t.includes('läk')) return 'legitimerad';
  return 'other';
}

function isInStockholm(location) {
  if (!location) return false;
  const l = location.toLowerCase();
  return l.includes('stockholm') || l.includes('södertälje') || l.includes('huddinge') || l.includes('solna') || l.includes('danderyd') || l.includes('nacka') || l.includes('lidingö') || l.includes('norrtälje') || l.includes('järfälla') || l.includes('täby') || l.includes('upplands väsby') || l.includes('haninge') || l.includes('tyresö') || l.includes('sollentuna') || l.includes('sundbyberg') || l.includes('botkyrka');
}

function makeId(source, title, location) {
  const str = `${source}::${normalizeTitle(title)}::${(location || '').toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `job_${Math.abs(hash)}`;
}

function checkDuplicate(job, existingJobs) {
  const myId = job.id;
  const myTitle = normalizeTitle(job.title);
  for (const existing of existingJobs) {
    if (existing.id === myId) return existing.source;
    const existTitle = normalizeTitle(existing.title);
    if (existTitle === myTitle && (existing.location || '') === (job.location || '') && existing.source !== job.source) {
      return existing.source;
    }
  }
  return null;
}

// ============================================================
// JOBBKÄLLOR
// ============================================================

async function fetchCapio() {
  const jobs = [];
  try {
    const url = 'https://capio.se/jobba-hos-oss/lediga-tjanster/?q=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('a[href*="/jobb/"], .job-listing, .vacancy, article.job, .position-item, [class*="job"], [class*="vacancy"]').each((i, el) => {
      const title = $(el).find('h2, h3, h4, .title, .job-title').first().text().trim() || $(el).text().trim();
      const location = $(el).find('.location, [class*="location"], [class*="ort"]').first().text().trim();
      const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
      const link = href.startsWith('http') ? href : `https://capio.se${href}`;
      if (title && title.length > 3) {
        jobs.push({ title, location: location || 'Sverige', link, source: 'Capio', sourceUrl: 'https://capio.se/jobba-hos-oss/lediga-tjanster/' });
      }
    });
    // Fallback: look for any links with 'läk' in text
    if (jobs.length === 0) {
      $('a').each((i, el) => {
        const text = $(el).text().trim();
        if (text.toLowerCase().includes('läk') && text.length < 120) {
          const href = $(el).attr('href') || '';
          const link = href.startsWith('http') ? href : `https://capio.se${href}`;
          jobs.push({ title: text, location: 'Sverige', link, source: 'Capio', sourceUrl: 'https://capio.se/jobba-hos-oss/lediga-tjanster/' });
        }
      });
    }
  } catch (e) {
    console.error('[Capio] Fel:', e.message);
  }
  return jobs;
}

async function fetchMeliva() {
  const jobs = [];
  try {
    const urls = [
      'https://meliva.se/lediga-tjanster/',
      'https://www.meliva.se/lediga-tjanster/'
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        const html = await res.text();
        const $ = cheerio.load(html);
        $('a').each((i, el) => {
          const text = $(el).text().trim();
          const href = $(el).attr('href') || '';
          if (text.toLowerCase().includes('läk') && text.length > 5 && text.length < 150) {
            const link = href.startsWith('http') ? href : `https://meliva.se${href}`;
            jobs.push({ title: text, location: 'Sverige', link, source: 'Meliva', sourceUrl: url });
          }
        });
        $('[class*="job"], [class*="lediga"], [class*="tjänst"]').each((i, el) => {
          const title = $(el).find('h2,h3,h4,.title').first().text().trim();
          const location = $(el).find('[class*="location"], [class*="ort"]').first().text().trim();
          const href = $(el).find('a').first().attr('href') || '';
          const link = href.startsWith('http') ? href : `https://meliva.se${href}`;
          if (title && title.length > 3) {
            jobs.push({ title, location: location || 'Sverige', link, source: 'Meliva', sourceUrl: url });
          }
        });
        if (jobs.length > 0) break;
      } catch (e) {}
    }
  } catch (e) {
    console.error('[Meliva] Fel:', e.message);
  }
  return jobs;
}

async function fetchKry() {
  const jobs = [];
  try {
    const url = 'https://careers.kry.se/jobs?q=l%C3%A4kare&department=Medical';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('[data-job-id], .job-card, [class*="job-item"], [class*="position"]').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title,[class*="title"]').first().text().trim() || $(el).text().trim();
      const location = $(el).find('[class*="location"], [class*="city"]').first().text().trim();
      const href = $(el).find('a').attr('href') || $(el).attr('href') || '';
      const link = href.startsWith('http') ? href : `https://careers.kry.se${href}`;
      if (title && title.length > 3) {
        jobs.push({ title, location: location || 'Sverige', link, source: 'Kry', sourceUrl: 'https://careers.kry.se/' });
      }
    });
  } catch (e) {
    console.error('[Kry] Fel:', e.message);
  }
  return jobs;
}

async function fetchPraktikertjanst() {
  const jobs = [];
  try {
    const url = 'https://www.praktikertjanst.se/lediga-tjanster/?q=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('a[href*="lediga"], [class*="job"], [class*="vacancy"], article').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title').first().text().trim() || $(el).text().trim().substring(0, 100);
      const location = $(el).find('[class*="location"], [class*="ort"]').first().text().trim();
      const href = $(el).find('a').attr('href') || $(el).attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.praktikertjanst.se${href}`;
      if (title && title.toLowerCase().includes('läk') && title.length > 3) {
        jobs.push({ title, location: location || 'Sverige', link, source: 'Praktikertjänst', sourceUrl: 'https://www.praktikertjanst.se/lediga-tjanster/' });
      }
    });
  } catch (e) {
    console.error('[Praktikertjänst] Fel:', e.message);
  }
  return jobs;
}

async function fetchRegionStockholm() {
  const jobs = [];
  try {
    const url = 'https://www.regionstockholm.se/jobb-och-karriar/lediga-tjanster/?q=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('[class*="job-item"], [class*="vacancy"], [class*="position"], article, li.job').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title,a').first().text().trim();
      const location = $(el).find('[class*="location"], [class*="ort"], [class*="place"]').first().text().trim();
      const deadline = $(el).find('[class*="deadline"], [class*="date"]').first().text().trim();
      const href = $(el).find('a').attr('href') || $(el).attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.regionstockholm.se${href}`;
      if (title && title.length > 3) {
        jobs.push({ title, location: location || 'Stockholm', link, deadline, source: 'Region Stockholm', sourceUrl: 'https://www.regionstockholm.se/jobb-och-karriar/' });
      }
    });
  } catch (e) {
    console.error('[Region Stockholm] Fel:', e.message);
  }
  return jobs;
}

async function fetchSodersjukhuset() {
  const jobs = [];
  try {
    const url = 'https://www.sodersjukhuset.se/jobb-och-karriar/lediga-jobb/?q=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('[class*="job"], [class*="vacancy"], article, li').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title,a').first().text().trim();
      const location = $(el).find('[class*="location"],[class*="ort"]').first().text().trim();
      const href = $(el).find('a').attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.sodersjukhuset.se${href}`;
      if (title && title.toLowerCase().includes('läk') && title.length > 3) {
        jobs.push({ title, location: location || 'Stockholm', link, source: 'Södersjukhuset', sourceUrl: 'https://www.sodersjukhuset.se/jobb-och-karriar/' });
      }
    });
  } catch (e) {
    console.error('[Södersjukhuset] Fel:', e.message);
  }
  return jobs;
}

async function fetchArbetsformedlingen() {
  const jobs = [];
  try {
    // Arbetsförmedlingen Platsbanken API
    const apiUrl = 'https://links.api.jobtechdev.se/joblinks?q=l%C3%A4kare&occupation-name=l%C3%A4kare&limit=50';
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'accept': 'application/json' },
      timeout: 12000
    });
    if (res.ok) {
      const data = await res.json();
      const hits = data.hits || data.jobs || data.data || [];
      hits.forEach(job => {
        const title = job.headline || job.occupation?.label || job.title || '';
        const location = job.workplace_address?.municipality || job.workplace_address?.region || '';
        const link = job.webpage_url || `https://arbetsformedlingen.se/platsbanken/annonser/${job.id}`;
        if (title) jobs.push({ title, location, link, source: 'Arbetsförmedlingen', sourceUrl: 'https://arbetsformedlingen.se/platsbanken' });
      });
    }
    // Fallback: scrape Platsbanken
    if (jobs.length === 0) {
      const url2 = 'https://arbetsformedlingen.se/platsbanken/?q=l%C3%A4kare';
      const res2 = await fetch(url2, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 });
      const html = await res2.text();
      const $ = cheerio.load(html);
      $('[class*="job"], [class*="vacancy"], [class*="plats"]').each((i, el) => {
        const title = $(el).find('h2,h3,.title,a').first().text().trim();
        const location = $(el).find('[class*="location"],[class*="ort"]').first().text().trim();
        const href = $(el).find('a').attr('href') || '';
        const link = href.startsWith('http') ? href : `https://arbetsformedlingen.se${href}`;
        if (title && title.toLowerCase().includes('läk')) {
          jobs.push({ title, location, link, source: 'Arbetsförmedlingen', sourceUrl: url2 });
        }
      });
    }
  } catch (e) {
    console.error('[Arbetsförmedlingen] Fel:', e.message);
  }
  return jobs;
}

async function fetchInternetmedicin() {
  const jobs = [];
  try {
    const url = 'https://www.internetmedicin.se/jobb/';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('a[href*="jobb"], [class*="job"], article, .job-listing').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title').first().text().trim() || $(el).text().trim().substring(0, 100);
      const location = $(el).find('[class*="location"],[class*="ort"]').first().text().trim();
      const href = $(el).find('a').attr('href') || $(el).attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.internetmedicin.se${href}`;
      if (title && title.length > 5) {
        jobs.push({ title, location: location || 'Sverige', link, source: 'Internetmedicin', sourceUrl: url });
      }
    });
  } catch (e) {
    console.error('[Internetmedicin] Fel:', e.message);
  }
  return jobs;
}

async function fetchVakanser() {
  const jobs = [];
  try {
    const url = 'https://www.vakanser.se/jobb/?freetext=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('[class*="job"], article, .listing-item, .vacancy').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title,a').first().text().trim();
      const location = $(el).find('[class*="location"],[class*="place"],[class*="city"]').first().text().trim();
      const deadline = $(el).find('[class*="deadline"],[class*="date"]').first().text().trim();
      const href = $(el).find('a').attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.vakanser.se${href}`;
      if (title && title.toLowerCase().includes('läk') && title.length > 3) {
        jobs.push({ title, location, link, deadline, source: 'Vakanser.se', sourceUrl: 'https://www.vakanser.se/' });
      }
    });
  } catch (e) {
    console.error('[Vakanser] Fel:', e.message);
  }
  return jobs;
}

async function fetchVarbi() {
  const jobs = [];
  try {
    // Varbi aggregates many healthcare jobs
    const url = 'https://varbi.com/sv/what/2/?q=l%C3%A4kare';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('[class*="job"], [class*="vacancy"], article, .position').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title,a').first().text().trim();
      const location = $(el).find('[class*="location"],[class*="ort"],[class*="place"]').first().text().trim();
      const href = $(el).find('a').attr('href') || '';
      const link = href.startsWith('http') ? href : `https://varbi.com${href}`;
      if (title && title.length > 3) {
        jobs.push({ title, location: location || 'Sverige', link, source: 'Varbi.se', sourceUrl: 'https://varbi.com/' });
      }
    });
  } catch (e) {
    console.error('[Varbi] Fel:', e.message);
  }
  return jobs;
}

async function fetchLinkedIn() {
  const jobs = [];
  try {
    // LinkedIn public job search (no auth)
    const searches = [
      'underl%C3%A4kare+Sverige',
      'specialistl%C3%A4kare+Sverige',
      'BT-l%C3%A4kare+Sverige',
      'distriktsläkare+Sverige'
    ];
    for (const s of searches) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${s}&location=Sverige`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'sv-SE,sv;q=0.9' },
        timeout: 10000
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      $('a.base-card__full-link, [class*="job-search-card"], .job-card-container').each((i, el) => {
        const title = $(el).find('h3,h4,.base-search-card__title,.job-card-list__title').first().text().trim();
        const company = $(el).find('[class*="company"],[class*="subtitle"],[class*="employer"]').first().text().trim();
        const location = $(el).find('[class*="location"],[class*="metadata"]').first().text().trim();
        const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
        if (title && title.length > 3) {
          jobs.push({ title, location: location || 'Sverige', company, link: href, source: 'LinkedIn', sourceUrl: 'https://www.linkedin.com/jobs/' });
        }
      });
    }
  } catch (e) {
    console.error('[LinkedIn] Fel:', e.message);
  }
  return jobs;
}

async function fetchJobtech() {
  const jobs = [];
  try {
    // Jobtech Search API (Swedish public API, no key needed)
    const url = 'https://jobsearch.api.jobtechdev.se/search?q=l%C3%A4kare&limit=100';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'accept': 'application/json' },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json();
      const hits = data.hits || [];
      hits.forEach(job => {
        const title = job.headline || '';
        const location = job.workplace_address?.municipality || job.workplace_address?.region || '';
        const link = job.webpage_url || `https://arbetsformedlingen.se/platsbanken/annonser/${job.id}`;
        const deadline = job.application_deadline || '';
        if (title) jobs.push({ title, location, link, deadline, source: 'Jobtech/Platsbanken', sourceUrl: 'https://jobsearch.api.jobtechdev.se/' });
      });
    }
  } catch (e) {
    console.error('[Jobtech] Fel:', e.message);
  }
  return jobs;
}

async function fetchSLSO() {
  const jobs = [];
  try {
    const url = 'https://www.slso.sll.se/sv/om-slso/jobba-hos-oss/lediga-jobb/';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('a, [class*="job"], [class*="vacancy"], article').each((i, el) => {
      const title = $(el).find('h2,h3,h4,.title').first().text().trim() || $(el).text().trim().substring(0, 100);
      const location = $(el).find('[class*="location"],[class*="ort"]').first().text().trim();
      const href = $(el).find('a').attr('href') || $(el).attr('href') || '';
      const link = href.startsWith('http') ? href : `https://www.slso.sll.se${href}`;
      if (title && title.toLowerCase().includes('läk') && title.length > 3) {
        jobs.push({ title, location: location || 'Stockholm', link, source: 'SLSO', sourceUrl: url });
      }
    });
  } catch (e) {
    console.error('[SLSO] Fel:', e.message);
  }
  return jobs;
}

// ============================================================
// Demo-jobb (visas alltid som fallback om källorna är tomma)
// ============================================================
function getDemoJobs() {
  return [
    { title: 'Underläkare', location: 'Karolinska Universitetssjukhuset, Stockholm', source: 'Demo / Exempelannons', sourceUrl: 'https://karolinska.se/', link: 'https://karolinska.se/jobba-hos-oss/', category: 'underlakar', isDemo: true },
    { title: 'BT-läkare bastjänstgöring', location: 'Södersjukhuset, Stockholm', source: 'Demo / Exempelannons', sourceUrl: 'https://www.sodersjukhuset.se/', link: 'https://www.sodersjukhuset.se/jobb-och-karriar/', category: 'bt', isDemo: true },
    { title: 'Specialistläkare allmänmedicin', location: 'Capio Citykliniken, Stockholm', source: 'Capio', sourceUrl: 'https://capio.se/jobba-hos-oss/', link: 'https://capio.se/jobba-hos-oss/', category: 'specialist', isDemo: true },
    { title: 'Legitimerad läkare, vikariat', location: 'Praktikertjänst, Göteborg', source: 'Praktikertjänst', sourceUrl: 'https://www.praktikertjanst.se/', link: 'https://www.praktikertjanst.se/lediga-tjanster/', category: 'legitimerad', isDemo: true },
    { title: 'Distriktsläkare, Kry', location: 'Stockholm / Remote', source: 'Kry', sourceUrl: 'https://careers.kry.se/', link: 'https://careers.kry.se/', category: 'legitimerad', isDemo: true },
    { title: 'Underläkare, sommarvikarié', location: 'Norrtälje sjukhus', source: 'Region Stockholm', sourceUrl: 'https://www.regionstockholm.se/', link: 'https://www.regionstockholm.se/jobb-och-karriar/', category: 'underlakar', isDemo: true },
    { title: 'Specialistläkare psykiatri', location: 'Uppsala', source: 'Jobtech/Platsbanken', sourceUrl: 'https://arbetsformedlingen.se/', link: 'https://arbetsformedlingen.se/platsbanken/', category: 'specialist', isDemo: true },
    { title: 'AT-läkare', location: 'Danderyds sjukhus, Stockholm', source: 'Vakanser.se', sourceUrl: 'https://www.vakanser.se/', link: 'https://www.vakanser.se/', category: 'underlakar', isDemo: true },
    { title: 'Legitimerad läkare, Meliva', location: 'Stockholm', source: 'Meliva', sourceUrl: 'https://meliva.se/', link: 'https://meliva.se/lediga-tjanster/', category: 'legitimerad', isDemo: true },
    { title: 'BT-läkare, vikariat 3 mån', location: 'Huddinge, Stockholm', source: 'SLSO', sourceUrl: 'https://www.slso.sll.se/', link: 'https://www.slso.sll.se/sv/om-slso/jobba-hos-oss/', category: 'bt', isDemo: true },
  ];
}

// ============================================================
// Huvudfunktion: bygg cache
// ============================================================
async function buildCache() {
  console.log('[Cache] Startar hämtning från alla källor...');
  const allJobs = [];
  const seenIds = new Set();

  const fetchers = [
    fetchJobtech,       // Best source - public API
    fetchCapio,
    fetchMeliva,
    fetchKry,
    fetchPraktikertjanst,
    fetchRegionStockholm,
    fetchSodersjukhuset,
    fetchArbetsformedlingen,
    fetchInternetmedicin,
    fetchVakanser,
    fetchVarbi,
    fetchLinkedIn,
    fetchSLSO,
  ];

  const results = await Promise.allSettled(fetchers.map(f => f()));

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      for (const job of result.value) {
        if (!job.title || job.title.length < 3) continue;
        const id = makeId(job.source, job.title, job.location);
        const category = job.category || detectCategory(job.title);
        const inStockholm = isInStockholm(job.location);
        const duplicateOf = checkDuplicate({ ...job, id }, allJobs);
        allJobs.push({ ...job, id, category, inStockholm, duplicateOf: duplicateOf || null, fetchedAt: new Date().toISOString() });
        seenIds.add(id);
      }
    }
  }

  // Add demo jobs if we got very few real ones
  if (allJobs.length < 5) {
    const demo = getDemoJobs();
    for (const job of demo) {
      const id = makeId(job.source, job.title, job.location);
      if (!seenIds.has(id)) {
        allJobs.push({ ...job, id, inStockholm: isInStockholm(job.location), duplicateOf: null, fetchedAt: new Date().toISOString() });
      }
    }
  }

  const sources = [...new Set(allJobs.map(j => j.source))];
  const cacheData = { jobs: allJobs, lastUpdated: new Date().toISOString(), totalCount: allJobs.length, sources };

  if (!fs.existsSync(path.dirname(CACHE_FILE))) {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
  console.log(`[Cache] Klar! ${allJobs.length} jobb sparade från ${sources.length} källor.`);
  return cacheData;
}

module.exports = { buildCache };

// Run directly
if (require.main === module) {
  buildCache().catch(console.error);
}
