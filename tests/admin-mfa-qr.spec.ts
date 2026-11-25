import { expect, test } from "@playwright/test";
import jsQR from "jsqr";

import { totpCode } from "../src/product/security/totp";
import { ADMINS, freshIp, provisionOrganization, signInWithMagicLink, uniqueSuffix } from "./support/admin-session";

test.describe("administrator 2FA setup page", () => {
  test("shows a scannable QR above the manual key and the scanned secret activates 2FA", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname) && !req.url().startsWith("data:")) external.push(req.url());
    });

    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
    const email = ADMINS.super("40");
    await provisionOrganization(page.request, { email, organizationName: `Admin QR ${uniqueSuffix()}` });
    await signInWithMagicLink(page, email, "en", /\/admin\/?$/);

    await expect(page.getByRole("heading", { name: "Set up administrator verification" })).toBeVisible();
    await page.waitForLoadState("networkidle"); // let React hydrate before clicking
    await page.getByRole("button", { name: "Generate setup key" }).click();

    const qr = page.getByTestId("mfa-qr");
    await expect(qr).toBeVisible();
    const key = page.locator("code").first();
    await expect(key).toBeVisible();

    // The QR sits above the manual key, and the manual key is still there as the fallback.
    const [qrBox, keyBox] = [await qr.boundingBox(), await key.boundingBox()];
    expect(qrBox!.y + qrBox!.height).toBeLessThanOrEqual(keyBox!.y);

    // Rasterise exactly what the page drew and decode it, as a phone camera would.
    const image = await qr.evaluate((svg) => {
      const [x, y, w] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number) as [number, number, number];
      const scale = 8;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = w * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);
      ctx.fillStyle = "#000";
      ctx.fill(new Path2D(svg.querySelector("path")!.getAttribute("d")!));
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { width: data.width, height: data.height, pixels: Array.from(data.data) };
    });
    const decoded = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height)?.data;
    expect(decoded, "QR decodes").toMatch(/^otpauth:\/\/totp\/TradeCatch:/);
    const secret = new URL(decoded!).searchParams.get("secret")!;

    // The QR and the manual key carry the same secret.
    expect((await key.innerText()).replace(/\s/g, "")).toBe(secret);

    // A reload while enrolment is pending must hand back the same secret, not a new one.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate setup key" }).click();
    await expect(page.locator("code").first()).toBeVisible();
    expect((await page.locator("code").first().innerText()).replace(/\s/g, "")).toBe(secret);

    // Enter the code the authenticator derives from the scanned secret.
    await page.getByRole("textbox", { name: "Code" }).fill(totpCode(secret));
    await page.getByRole("button", { name: "Turn on verification" }).click();
    await expect(page.getByRole("heading", { name: "Set up administrator verification" })).toBeHidden({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/?$/);

    expect(external, "no request left this machine").toEqual([]);
  });
});
