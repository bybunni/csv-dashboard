import path from "node:path";
import fs from "node:fs/promises";
import { test, expect } from "@playwright/test";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/sensor.csv");

async function loadFixture(page) {
  await page.goto("/");
  await page.setInputFiles("#fileInput", fixturePath);
  await expect(page.locator("#statusBar")).toContainText("Loaded sensor.csv");
}

test("loads CSV and renders spreadsheet view", async ({ page }) => {
  await loadFixture(page);

  await expect(page.locator("#tableContainer .data-table")).toBeVisible();
  await expect(page.locator("#tableMeta")).toContainText("rows");
  await expect(page.locator("#tableContainer thead th").nth(1)).toContainText("time");
});

test("renders 2D controls and plot legend", async ({ page }) => {
  await loadFixture(page);
  await page.click("button[data-tab='plot2d']");

  await expect(page.locator("#yColumns2d input[type='checkbox']").first()).toBeVisible();
  await expect(page.locator("#legend2d")).toContainText("series");
});

test("renders 3D metadata after axis selection defaults", async ({ page }) => {
  await loadFixture(page);
  await page.click("button[data-tab='plot3d']");

  await expect(page.locator("#xSelect3d")).toBeEnabled();
  await expect(page.locator("#meta3d")).toContainText("Points:");
});

test("applies column filters, sort, and updates quick stats", async ({ page }) => {
  await loadFixture(page);

  await page.fill("#filter-col-1", ">20.8");
  await expect(page.locator("#tableMeta")).toContainText("2 of 6 rows");
  await expect(page.locator("#tableContainer tbody tr")).toHaveCount(2);

  await page.selectOption("#sortColumnSelect", "2");
  await page.selectOption("#sortDirectionSelect", "desc");

  await expect(page.locator("#tableContainer tbody tr").first().locator("td").nth(2)).toHaveText("101.7");

  await page.selectOption("#statsColumnSelect", "1");
  await expect(page.locator("#quickStats")).toContainText("Mean");
  await expect(page.locator("#quickStats")).toContainText("Rows in view");
});

test("builds plots from Data filters and allows plot-level subselect", async ({ page }) => {
  await loadFixture(page);

  await page.fill("#filter-col-1", ">20.8");
  await expect(page.locator("#tableMeta")).toContainText("2 of 6 rows");

  await page.click("button[data-tab='plot2d']");
  await expect(page.locator("#legend2d")).toContainText("Using 2 of 2 filtered rows");

  await page.selectOption("#subFilterColumn2d", "2");
  await page.fill("#subFilterQuery2d", ">=101.7");
  await expect(page.locator("#legend2d")).toContainText("Using 1 of 2 filtered rows");

  await page.click("button[data-tab='plot3d']");
  await page.selectOption("#subFilterColumn3d", "2");
  await page.fill("#subFilterQuery3d", ">=101.7");
  await expect(page.locator("#meta3d")).toContainText("Using 1 of 2 filtered rows");
});

test("supports comma-compound filters in Data and plot subfilters", async ({ page }) => {
  await loadFixture(page);

  await page.fill("#filter-col-0", "1,3");
  await expect(page.locator("#tableMeta")).toContainText("2 of 6 rows");

  await page.fill("#filter-col-0", ">1,<4");
  await expect(page.locator("#tableMeta")).toContainText("2 of 6 rows");

  await page.click("button[data-tab='plot2d']");
  await page.selectOption("#subFilterColumn2d", "2");
  await page.fill("#subFilterQuery2d", ">101.2,<101.6");
  await expect(page.locator("#legend2d")).toContainText("Using 1 of 2 filtered rows");
});

test("exports the current filtered and sorted view to csv", async ({ page }) => {
  await loadFixture(page);

  await page.fill("#filter-col-1", ">20.8");
  await page.selectOption("#sortColumnSelect", "2");
  await page.selectOption("#sortDirectionSelect", "desc");
  await expect(page.locator("#tableMeta")).toContainText("2 of 6 rows");

  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportBtn");
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("sensor_data_view.csv");
  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  const csv = await fs.readFile(filePath, "utf8");
  const lines = csv.trim().split(/\r?\n/);

  expect(lines[0]).toBe("time,temp_c,pressure_kpa,humidity_pct,vibration");
  expect(lines[1]).toBe("5,20.9,101.7,44,0.053");
  expect(lines[2]).toBe("4,21.0,101.6,45,0.050");
});
