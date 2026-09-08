import { expect, test } from "@playwright/test";
import { SYNTHETIC_PREDICTION_ID } from "../../lib/testing/fixtures";

test("homepage presents the product and live-data sections", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /public predictions/i })).toBeVisible();
  await expect(page.getByText(/live market context/i).first()).toBeVisible();
  const mobileMenu = page.getByRole("button", { name: "Open navigation" });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await expect(page.getByRole("link", { name: /experts/i }).first()).toBeVisible();
});

test("expert directory is usable without seeded predictions", async ({ page }) => {
  await page.goto("/experts");
  await expect(page.getByRole("heading", { name: "Experts" })).toBeVisible();
  await expect(page.getByText("Nate Silver").first()).toBeVisible();
});

test("atomic receipt renders source, criteria, and status", async ({ page }) => {
  await page.goto(`/predictions/${SYNTHETIC_PREDICTION_ID}`);
  await expect(page.getByRole("heading", { name: /synthetic example benchmark/i })).toBeVisible();
  await expect(page.getByText("Original statement")).toBeVisible();
  await expect(page.getByText("Resolution criteria")).toBeVisible();
  await expect(page.getByText("This prediction remains open.")).toBeVisible();
});

test("methodology explains immutable criteria and scoring", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: /methodology/i })).toBeVisible();
  await expect(page.getByText(/wilson/i).first()).toBeVisible();
  await expect(page.getByText(/freezes/i).first()).toBeVisible();
});
