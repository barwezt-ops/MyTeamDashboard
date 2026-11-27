// Shared steps for the V2 screen tests, which run against the synthetic team.
import {
  expect,
  type Cookie,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { expectAccessible } from "./accessibility";

export const teamUrl = "http://127.0.0.1:3212";

// Sign-in is limited to five a minute, so one session is reused.
let session: Cookie[] | undefined;

export async function signIn(page: Page) {
  if (session) await page.context().addCookies(session);
  await page.goto("/");
  if (!session) {
    await page.getByLabel("Password").fill("synthetic-smoke-password");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.locator(".sidebar")).toBeVisible();
  session = await page.context().cookies();
}

export async function openTeam(page: Page, path = "/", reset = "/reset") {
  expect(
    (await page.request.post("http://127.0.0.1:3219" + reset)).status(),
  ).toBe(204);
  await page.clock.install({ time: new Date("2026-11-26T12:00:00Z") });
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1")
      external.push(request.url());
  });
  await signIn(page);
  if (path !== "/") await page.goto(path);
  return () => {
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  };
}

/**
 * Checks layout and accessibility at every supported width and saves the 1440
 * and 390 screenshots. Set SAVE_SCREENSHOTS to refresh the copies in docs.
 */
export async function reviewScreen(page: Page, info: TestInfo, name: string) {
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator("main .skeleton, main .loading")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${name} at ${width}`,
    ).toBe(width);
    await expectAccessible(page);
    if (width !== 1440 && width !== 390) continue;
    const file = `${name}-${width}.png`;
    if (process.env.SAVE_SCREENSHOTS)
      mkdirSync("docs/design", { recursive: true });
    // A window as tall as the page, so the sidebar and the phone navigation sit
    // where a person sees them and not part way down a long capture.
    await page.setViewportSize({
      width,
      height: await page.evaluate(() => document.documentElement.scrollHeight),
    });
    await page.screenshot({
      path: process.env.SAVE_SCREENSHOTS
        ? "docs/design/" + file
        : info.outputPath(file),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
