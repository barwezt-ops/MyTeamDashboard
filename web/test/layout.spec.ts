// Layout promises from the owner's review: nothing scrolls sideways or gets cut
// off on Home, and the sidebar reaches the bottom of every page.
import { expect, test, type Page } from "@playwright/test";
import { openTeam, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

const settled = async (page: Page) => {
  await expect(page.locator("main .skeleton, main .loading")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
};

/** The longest values each column of yesterday's exceptions can carry. */
const longest = {
  name: "Christopher W.",
  line: "Inbound Training",
  status: "2nd Half Forced UPL",
  login: "12:45 PM",
  late: "1h 16m",
  missing: "8h 45m",
  break: "1h 16m",
};

for (const values of ["recorded", "longest"] as const)
  test(`yesterday's exceptions fit without sideways scroll: ${values} values`, async ({
    page,
  }) => {
    if (values === "longest")
      await page.route("**/api/v2/home", async (route) => {
        const response = await route.fetch();
        const view = await response.json();
        view.exceptions = view.exceptions.map((row: object) => ({
          ...row,
          ...longest,
        }));
        await route.fulfill({ response, json: view });
      });
    const clean = await openTeam(page);
    const region = page.getByRole("region", {
      name: "Yesterday, in exceptions scroll area",
    });
    for (const width of [1280, 1366, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await settled(page);
      await expect(region).toBeVisible();
      const overflow = await region.evaluate(
        (node) => node.scrollWidth - node.clientWidth,
      );
      expect(overflow, `at ${width}`).toBeLessThanOrEqual(0);
    }
    await expect(region.locator("tbody tr").first()).toContainText(
      values === "longest" ? "1h 16m" : "16m",
    );
    clean();
  });

test("the shout-out shows four names, then the rest, with nothing cut off", async ({
  page,
}) => {
  const clean = await openTeam(page);
  const card = page.getByRole("region", { name: "Worth a shout-out" });
  const names = card.getByRole("listitem");
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    await expect(names).toHaveCount(4);
    // Nothing inside the card is hidden or reachable only by scrolling.
    const cut = () =>
      card.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [node, ...node.querySelectorAll("*")].filter((element) => {
          const own = element.getBoundingClientRect();
          return element.scrollHeight > element.clientHeight + 1 &&
            getComputedStyle(element).overflowY !== "visible"
            ? true
            : own.bottom > box.bottom + 1;
        }).length;
      });
    expect(await cut(), `collapsed at ${width}`).toBe(0);
    const more = card.getByRole("button", { name: /^and \d+ more$/ });
    const hidden = Number((await more.textContent())!.match(/\d+/)![0]);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(names).toHaveCount(4 + hidden);
    expect(await cut(), `expanded at ${width}`).toBe(0);
    await card.getByRole("button", { name: "Show fewer" }).click();
    await expect(names).toHaveCount(4);
  }
  clean();
});

test("the sidebar fills the screen at the bottom of a long page", async ({
  page,
}) => {
  const clean = await openTeam(page, "/agent/99101");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settled(page);
  for (const part of [0.5, 1]) {
    const seen = await page.evaluate((part) => {
      window.scrollTo(0, document.documentElement.scrollHeight * part);
      const column = document.querySelector(".sidebar")!;
      const box = column.getBoundingClientRect();
      return {
        page: document.documentElement.scrollHeight,
        scrolled: window.scrollY,
        top: box.top,
        bottom: box.bottom,
        // Every point down the left edge of the screen belongs to the sidebar.
        covered: [1, 450, window.innerHeight - 1].every(
          (y) => !!document.elementFromPoint(2, y)?.closest(".sidebar"),
        ),
        colour: getComputedStyle(column).backgroundColor,
      };
    }, part);
    expect(seen.page).toBeGreaterThan(1800);
    expect(seen.scrolled).toBeGreaterThan(400);
    expect(Math.abs(seen.top)).toBeLessThan(1);
    expect(seen.bottom).toBeGreaterThanOrEqual(899);
    expect(seen.covered).toBe(true);
    expect(seen.colour).toBe("rgb(30, 58, 50)");
    await expect(
      page.getByRole("navigation", { name: "Dashboard" }),
    ).toBeInViewport();
  }
  clean();
});
