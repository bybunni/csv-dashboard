import path from "node:path";
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
