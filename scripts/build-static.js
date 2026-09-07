// Bygger dist/ som Vercel serverar statiskt: gränssnittet från public/ plus
// den senast byggda jobbcachen, så sidan visar jobb även om API:t är nere.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDirectory = path.join(root, "public");
const distDirectory = path.join(root, "dist");
const cacheSource = path.join(root, "data", "jobs-cache.json");
const cacheTarget = path.join(distDirectory, "data", "jobs-cache.json");

async function main() {
  await fs.rm(distDirectory, { recursive: true, force: true });
  await fs.mkdir(path.join(distDirectory, "data"), { recursive: true });

  await fs.cp(publicDirectory, distDirectory, { recursive: true });

  try {
    await fs.copyFile(cacheSource, cacheTarget);
    const { size } = await fs.stat(cacheTarget);
    console.log(`jobs-cache.json kopierad (${Math.round(size / 1024)} kB)`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    // Utan cache faller sidan tillbaka på API:t. Skriv en tom men giltig fil så
    // att fetch inte kraschar på en 404-HTML-sida.
    await fs.writeFile(
      cacheTarget,
      JSON.stringify({ jobs: [], sourceSummaries: [], stats: {}, lastUpdated: null }),
      "utf8"
    );
    console.warn("data/jobs-cache.json saknas - skrev en tom cache i dist/.");
  }

  const built = await fs.readdir(distDirectory);
  console.log(`dist/ innehåller: ${built.join(", ")}`);
}

await main();
