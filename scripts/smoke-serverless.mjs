// Röktest: startar Express-appen i samma läge som Vercel (VERCEL=1, skrivskyddad
// projektmapp) och kontrollerar att API:t svarar med jobb ur den paketerade cachen.
import http from "node:http";

// Sätts före den dynamiska importen - statiska import-satser körs annars först.
process.env.VERCEL = "1";
const { default: app } = await import("../server.js");

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let failed = false;

async function check(label, url, verify) {
  try {
    const response = await fetch(base + url, { headers: { accept: "application/json" } });
    const body = await response.text();
    const parsed = response.headers.get("content-type")?.includes("json")
      ? JSON.parse(body)
      : body;
    const problem = verify(response, parsed);
    if (problem) {
      console.error(`FEL  ${label}: ${problem}`);
      failed = true;
    } else {
      console.log(`OK   ${label} (${response.status})`);
    }
  } catch (error) {
    console.error(`FEL  ${label}: ${error.message}`);
    failed = true;
  }
}

await check("GET /api/status", "/api/status", (res, body) => {
  if (res.status !== 200) return `status ${res.status}`;
  if (!Array.isArray(body.jobs)) return "jobs saknas";
  if (body.jobs.length === 0) return "0 jobb - cachen lästes inte";
  if (!body.lastUpdated) return "lastUpdated saknas";
  console.log(`     ${body.jobs.length} jobb, senast uppdaterad ${body.lastUpdated}`);
  return null;
});

await check("GET /api/jobs", "/api/jobs", (res, body) => {
  if (res.status !== 200) return `status ${res.status}`;
  if (!Array.isArray(body.jobs) || body.jobs.length === 0) return "inga jobb";
  return null;
});

await check("GET /api/subscriptions", "/api/subscriptions?email=x@y.se", (res, body) => {
  if (res.status !== 200) return `status ${res.status}`;
  if (!("subscription" in body)) return "subscription saknas";
  return null;
});

await check("GET /nagot-okant", "/nagot-okant", (res) =>
  res.status === 404 ? null : `status ${res.status} (väntade 404)`
);

// Skrivvägen: en prenumeration ska sparas utan att kasta på skrivskyddat filsystem.
try {
  const response = await fetch(base + "/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "roktest@example.com",
      profileId: "roktest",
      profileName: "Röktest",
      sendWelcome: false,
      notifications: {},
    }),
  });
  const body = await response.json();
  if (response.status !== 200 || !body.subscription) {
    console.error(`FEL  POST /api/subscriptions: status ${response.status}`);
    failed = true;
  } else {
    console.log(`OK   POST /api/subscriptions (${response.status})`);
  }
} catch (error) {
  console.error(`FEL  POST /api/subscriptions: ${error.message}`);
  failed = true;
}

server.close();
process.exit(failed ? 1 : 0);
