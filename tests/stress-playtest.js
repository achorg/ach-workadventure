const { chromium } = require("@playwright/test");

const PLAY_URL = process.env.PLAY_URL || "https://workadventure.apjan.co";
const ROOM_PATH =
  process.env.ROOM_PATH ||
  "/_/global/achorg.github.io/ach2025-map/map.json";
const USERS = Number(process.env.USERS || 50);
const TARGET_JOINED = Number(process.env.TARGET_JOINED || USERS);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || USERS);
const RAMP_MS = Number(process.env.RAMP_MS || 1500);
const HOLD_MS = Number(process.env.HOLD_MS || 180000);
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS || 120000);
const HEADLESS = process.env.HEADLESS !== "false";
const BOT_X = Number(process.env.BOT_X || 783);
const BOT_Y = Number(process.env.BOT_Y || 170);
const BOT_PREFIX = process.env.BOT_PREFIX || "Bot";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFirstVisible(page, candidates, timeoutMs) {
  const pollMs = 250;
  const maxChecks = Math.ceil(timeoutMs / pollMs);

  for (let i = 0; i < maxChecks; i++) {
    for (const candidate of candidates) {
      if (await candidate.locator.isVisible().catch(() => false)) {
        return candidate.name;
      }
    }
    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for UI state after ${timeoutMs}ms`);
}

async function joinUser(page, name, targetUrl, index) {
  const startedAt = Date.now();

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

  const loginInput = page.getByTestId("loginSceneNameInput");
  const loginSubmit = page.locator("button.loginSceneFormSubmit");
  const selectCharacterSubmit = page.locator("button.selectCharacterSceneFormSubmit");
  const inGameMic = page.getByTestId("microphone-button");
  const inGameCanvas = page.locator("canvas").first();

  for (let attempt = 1; attempt <= 2; attempt++) {
    const state = await waitForFirstVisible(
      page,
      [
        { name: "login", locator: loginInput },
        { name: "character", locator: selectCharacterSubmit },
        { name: "ingame-mic", locator: inGameMic },
        { name: "ingame-canvas", locator: inGameCanvas },
      ],
      JOIN_TIMEOUT_MS
    );

    if (state === "login") {
      await loginInput.fill(name);
      await loginSubmit.click();
      continue;
    }

    if (state === "character") {
      await selectCharacterSubmit.click();
      break;
    }

    if (state === "ingame-mic" || state === "ingame-canvas") {
      break;
    }

    if (attempt === 1) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    }
  }

  const saveButton = page.getByText("Save", { exact: true });
  if (await saveButton.isVisible({ timeout: 15000 }).catch(() => false)) {
    await saveButton.click();
  }

  await Promise.race([
    inGameMic.waitFor({
      state: "visible",
      timeout: JOIN_TIMEOUT_MS,
    }),
    inGameCanvas.waitFor({
      state: "visible",
      timeout: JOIN_TIMEOUT_MS,
    }),
  ]);

  // Put bots in a compact visible group so manual checks are easy.
  await page
    .evaluate(
      async ({ x, y }) => {
        const wa = window.WA;
        if (!wa) return;
        await wa.onInit();
        await wa.player.teleport(x, y);
      },
      {
        x: BOT_X + (index % 4) * 24,
        y: BOT_Y + Math.floor(index / 4) * 24,
      }
    )
    .catch(() => {});

  return Date.now() - startedAt;
}

async function nudgeUser(page) {
  const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const key = keys[Math.floor(Math.random() * keys.length)];
  await page.keyboard.press(key).catch(() => {});
}

(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const targetUrl = new URL(ROOM_PATH, PLAY_URL).toString();
  const sessions = [];
  const joinLatencies = [];
  const failed = [];

  console.log(
    `Starting stress playtest: users=${USERS}, targetJoined=${TARGET_JOINED}, maxAttempts=${MAX_ATTEMPTS}, url=${targetUrl}`
  );

  let attempts = 0;
  while (sessions.length < TARGET_JOINED && attempts < MAX_ATTEMPTS) {
    const i = attempts;
    attempts += 1;
    const context = await browser.newContext({
      permissions: ["camera", "microphone"],
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const name = `${BOT_PREFIX}${String(i + 1).padStart(2, "0")}`;

    try {
      const latency = await joinUser(page, name, targetUrl, i);
      sessions.push({ context, page, name });
      joinLatencies.push(latency);
      console.log(`[JOINED] ${name} in ${latency}ms`);
    } catch (e) {
      failed.push({ name, error: String(e) });
      await context.close().catch(() => {});
      console.log(`[FAILED] ${name}: ${String(e)}`);
    }

    await sleep(RAMP_MS);
  }

  const joined = sessions.length;
  const p95 =
    joinLatencies.length > 0
      ? [...joinLatencies].sort((a, b) => a - b)[Math.floor(joinLatencies.length * 0.95) - 1] ||
        joinLatencies[joinLatencies.length - 1]
      : 0;

  console.log(`Joined ${joined}/${TARGET_JOINED}. attempts=${attempts}. join_p95_ms=${p95}`);
  if (failed.length > 0) {
    console.log(`Failed users: ${failed.length}`);
  }

  const endAt = Date.now() + HOLD_MS;
  while (Date.now() < endAt) {
    await Promise.all(sessions.map(({ page }) => nudgeUser(page)));
    await sleep(1000);
  }

  await Promise.all(sessions.map(({ context }) => context.close().catch(() => {})));
  await browser.close();

  console.log("Stress playtest complete.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
