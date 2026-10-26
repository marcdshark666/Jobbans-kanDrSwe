// Veckokort: sammanfattar NYA relevanta läkartjänster (BT, ST, vikariat, underläkare) som ETT kort.
// Inget mejl, ingen Telegram. Kör: node scripts/veckokort.mjs [--post] [--dry-run] [--lokal]
//   --post   lägger kortet på Work List Bots-tavlan via bots-svar (annars skrivs det bara ut)
//   --lokal  läs data/jobs-cache.json i stället för live-API:t
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, "data", "veckokort-state.json");
const LIVE = "https://jobbans-kandrswe.vercel.app/api/jobs";
const args = new Set(process.argv.slice(2));

const VIKARIAT = /vikari|sommar|semester|tim(anst|arvode)|konsult|stafett|bemanning|extrapass/i;
const BT = /\bBT\b|bastjänstgöring|bastjanstgoring/i;
const ST = /\bST\b|specialiseringstjänst|ST-block|ST-läkare/i;
const BRUS = /assistent|sekreterare|chef|läkarchef|spontanansökan|sjuksköterska|undersköterska|rapportör|koordinator/i;
const HEL = /heldygn|akut|jour/i;
const ORTER = { stockholm: "Stockholm", uppsala: "Uppsala" };

async function laddaJobb() {
  if (!args.has("--lokal")) {
    try {
      const res = await fetch(LIVE, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.jobs) && data.jobs.length) return { ...data, kalla: "live" };
    } catch (error) {
      console.error(`veckokort: live-API misslyckades (${error.message}), faller tillbaka på cache`);
    }
  }
  const data = JSON.parse(await readFile(path.join(ROOT, "data", "jobs-cache.json"), "utf8"));
  return { ...data, kalla: "cache" };
}

async function laddaState() {
  try {
    const s = JSON.parse(await readFile(STATE, "utf8"));
    return { sedda: s.sedda && typeof s.sedda === "object" ? s.sedda : {}, senast: s.senast ?? null };
  } catch {
    return { sedda: {}, senast: null };
  }
}

function nyckel(job) {
  return job.historyKey || job.id || job.link;
}

function typ(job) {
  const text = job.title;
  if (BRUS.test(text)) return [];
  const t = [];
  if (BT.test(text) || (job.category === "BT-läkare" && !ST.test(text))) t.push("BT");
  if (ST.test(text) || (job.category === "ST-läkare" && !BT.test(text))) t.push("ST");
  if (job.category === "Underläkare") t.push("Underläkare");
  if (VIKARIAT.test(text)) t.push("Vikariat");
  return t;
}

function poang(job, t) {
  let p = 0;
  if (t.includes("BT")) p += 5;
  if (t.includes("ST")) p += 4;
  if (t.includes("Underläkare")) p += 3;
  if (t.includes("Vikariat")) p += 2;
  if (job.stockholmMatch) p += 2;
  if (job.uppsalaMatch) p += 2;
  if (HEL.test(job.title)) p += 1;
  return p;
}

function plats(job) {
  const o = [];
  if (job.stockholmMatch) o.push(ORTER.stockholm);
  if (job.uppsalaMatch) o.push(ORTER.uppsala);
  return o.length ? o.join("/") : job.location || "Okänd ort";
}

function rad(j) {
  return `- ${j.t.join("+")} · ${j.job.title.slice(0, 90)} — ${plats(j.job)}\n  ${j.job.link}`;
}

async function main() {
  const data = await laddaJobb();
  const state = await laddaState();
  const forstaGangen = state.senast === null;
  const nu = new Date().toISOString();

  const unika = new Map();
  for (const job of data.jobs) {
    if (job.isDuplicate) continue;
    const k = nyckel(job);
    if (k && !unika.has(k)) unika.set(k, job);
  }

  const kandidater = [];
  for (const [k, job] of unika) {
    const t = typ(job);
    if (!t.length) continue;
    if (state.sedda[k]) continue;
    kandidater.push({ k, job, t, p: poang(job, t) });
  }
  kandidater.sort((a, b) => b.p - a.p);

  const grupper = { BT: [], ST: [], Vikariat: [], Underläkare: [] };
  for (const c of kandidater) {
    const g = c.t.find((x) => grupper[x]) ?? "Underläkare";
    grupper[g].push(c);
  }
  const sektion = (namn, lista, max) =>
    lista.length ? `**${namn} (${lista.length})**\n${lista.slice(0, max).map(rad).join("\n")}${lista.length > max ? `\n  …och ${lista.length - max} till i appen` : ""}` : "";

  const fel = (data.sourceSummaries ?? []).filter((s) => s.status !== "ok" || s.count === 0);
  const alder = data.lastUpdated ? Math.round((Date.now() - new Date(data.lastUpdated)) / 3_600_000) : null;
  const varningar = [];
  if (data.kalla === "cache") varningar.push("Live-API:t nåddes inte – data från cache");
  if (alder !== null && alder > 48) varningar.push(`Data är ${Math.round(alder / 24)} dygn gammal`);
  for (const s of fel) varningar.push(`Källa utan träffar: ${s.name} (${s.status})`);

  const text = [
    forstaGangen ? "Första veckokortet – alla matchande tjänster räknas som nya (baslinje)." : `Nya sedan ${state.senast.slice(0, 10)}.`,
    `Totalt ${kandidater.length} nya relevanta av ${unika.size} unika annonser.`,
    sektion("BT-tjänster", grupper.BT, 8),
    sektion("ST-tjänster", grupper.ST, 8),
    sektion("Vikariat/sommar/konsult", grupper.Vikariat, 8),
    sektion("Underläkare", grupper["Underläkare"], 6),
    varningar.length ? `⚠️ ${varningar.join("; ")}` : "",
    "Tips: filtrera mer i appen https://jobbans-kandrswe.vercel.app",
  ].filter(Boolean).join("\n\n");

  console.log(text);
  if (args.has("--dry-run")) return;

  for (const c of kandidater) state.sedda[c.k] = nu;
  // rensa poster äldre än 120 dygn så att filen inte växer
  for (const [k, v] of Object.entries(state.sedda)) {
    if (Date.now() - new Date(v) > 120 * 86_400_000) delete state.sedda[k];
  }
  await mkdir(path.dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify({ senast: nu, sedda: state.sedda }, null, 1));

  if (args.has("--post")) {
    const r = spawnSync("node", [
      path.join(os.homedir(), ".claude", "tools", "bots-svar.mjs"),
      "--fran", "agent:site-Jobbans-kanDrSwe", "--chatt", "site-jobbans-kandrswe",
      "--fas", "klart", "--status", varningar.length ? "delvis" : "ok",
      "--resultat", `🗓️ Veckokort Jobbradar: ${kandidater.length} nya relevanta tjänster\n\n${text}`,
      "--gjort", "Hämtade live-API, filtrerade BT/ST/vikariat/underläkare, tog bort dubbletter och redan sedda",
      ...(varningar.length ? ["--problem", varningar.join("; "), "--extrainfo", "Ingen"] : []),
      "--verifierat", `Källa: ${data.kalla}`, "--aterstar", "Nästa veckokort om 7 dygn",
    ], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`veckokort: bots-svar misslyckades: ${r.stderr || r.stdout}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(`veckokort: ${e.message}`); process.exit(1); });
