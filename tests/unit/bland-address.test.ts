import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressesMatch,
  checkServiceAddress,
} from "../../src/product/scheduling/address";

describe("service address check", () => {
  it("accepts a complete one-line address and canonicalises it", () => {
    const check = checkServiceAddress({
      address: "12 rue des Pins, Laval, QC H7N 1A1",
    });
    assert.equal(check.status, "complete");
    if (check.status !== "complete") return;
    assert.equal(check.address.formatted, "12 rue des Pins, Laval, QC H7N 1A1");
    assert.equal(check.address.province, "QC");
    assert.equal(check.address.postalCode, "H7N 1A1");
  });

  it("builds the same address from separate parts, accents and case aside", () => {
    const check = checkServiceAddress({
      street: "12 rue des Pins",
      city: "Laval",
      province: "Québec",
      postalCode: "h7n1a1",
    });
    assert.equal(check.status, "complete");
    if (check.status !== "complete") return;
    assert.equal(check.address.province, "QC");
    assert.equal(check.address.postalCode, "H7N 1A1");
  });

  it("derives the province from an unambiguous postal code", () => {
    const check = checkServiceAddress({
      street: "12 rue des Pins",
      city: "Laval",
      postalCode: "H7N 1A1",
    });
    assert.equal(check.status, "complete");
    if (check.status === "complete") assert.equal(check.address.province, "QC");
  });

  it("books without a postal code but recommends one", () => {
    const check = checkServiceAddress({
      street: "12 rue des Pins",
      unit: "4",
      city: "Laval",
      province: "QC",
    });
    assert.equal(check.status, "complete");
    if (check.status !== "complete") return;
    assert.deepEqual(check.recommended, ["postal_code"]);
    assert.match(check.address.formatted, /#4/);
  });

  it("says exactly what is still missing instead of guessing", () => {
    const noProvince = checkServiceAddress({
      address: "12 rue des Pins, Laval",
    });
    assert.equal(noProvince.status, "incomplete");
    if (noProvince.status === "incomplete") {
      assert.deepEqual(noProvince.missing, ["province"]);
      assert.equal(noProvince.partial.city, "Laval");
    }
    const noNumber = checkServiceAddress({
      street: "rue des Pins",
      city: "Laval",
      province: "QC",
    });
    assert.equal(noNumber.status, "incomplete");
    if (noNumber.status === "incomplete") {
      assert.deepEqual(noNumber.missing, ["street_number"]);
    }
  });

  it("rejects what cannot be a place a technician drives to", () => {
    assert.deepEqual(
      checkServiceAddress({ street: "PO Box 12", city: "Laval", province: "QC" }),
      { status: "invalid", problem: "po_box", field: "street" },
    );
    assert.deepEqual(
      checkServiceAddress({
        street: "12 rue des Pins",
        city: "Laval",
        province: "ON",
        postalCode: "H7N 1A1",
      }),
      { status: "invalid", problem: "postal_province_mismatch", field: "postal_code" },
    );
    assert.deepEqual(
      checkServiceAddress({
        street: "12 Main Street",
        city: "Toronto",
        province: "ON",
        postalCode: "D5V 2T6",
      }),
      { status: "invalid", problem: "invalid_postal_code", field: "postal_code" },
    );
  });

  it("an empty address is incomplete, not valid", () => {
    const check = checkServiceAddress({ address: "" });
    assert.equal(check.status, "incomplete");
  });
});

describe("addressesMatch", () => {
  it("treats spelling, accent, case, comma and street-type variants as one address", () => {
    assert.equal(
      addressesMatch("12 rue des Pins, Laval", "12, Rue des Pins Laval QC"),
      true,
    );
    assert.equal(
      addressesMatch("12 Main Street, Toronto", "12 Main St Toronto ON"),
      true,
    );
  });

  it("keeps different buildings and different units apart", () => {
    assert.equal(
      addressesMatch("12 rue des Pins, Laval", "14 rue des Pins, Laval"),
      false,
    );
    assert.equal(
      addressesMatch("12 Main St, Apt 4, Toronto", "12 Main St, Apt 5, Toronto"),
      false,
    );
  });
});
