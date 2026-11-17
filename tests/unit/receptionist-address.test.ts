import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addressIsComplete,
  mergeAddress,
  tidyAddress,
  withCity,
} from "../../src/product/receptionist/address";
import { cleanSlots, mergeSlots } from "../../src/product/receptionist/agent-calls";

describe("address handling", () => {
  it("makes one clean line", () => {
    assert.equal(tidyAddress("  123  Rue   Principale ,\nLaval ,, "), "123 Rue Principale, Laval");
    assert.equal(tidyAddress("12 Main\u0000 St\t, Laval"), "12 Main St, Laval");
  });

  it("writes a Canadian postal code in the standard form", () => {
    assert.equal(tidyAddress("123 Rue Principale, Laval h7n1a1"), "123 Rue Principale, Laval H7N 1A1");
    assert.equal(tidyAddress("123 Rue Principale, Laval h7n-1a1"), "123 Rue Principale, Laval H7N 1A1");
  });

  it("returns nothing for empty or non-text input, and caps the length", () => {
    assert.equal(tidyAddress(""), undefined);
    assert.equal(tidyAddress("  , "), undefined);
    assert.equal(tidyAddress(undefined), undefined);
    assert.equal(tidyAddress(42 as never), undefined);
    assert.ok((tidyAddress("a ".repeat(400)) ?? "").length <= 300);
  });

  it("an address a technician can find has a civic number or at least three words", () => {
    assert.equal(addressIsComplete("123 Rue Principale"), true);
    assert.equal(addressIsComplete("Rue Principale Laval"), true);
    assert.equal(addressIsComplete("Laval"), false);
    assert.equal(addressIsComplete("Rue Principale"), false);
    assert.equal(addressIsComplete(undefined), false);
  });

  it("adds a separately given city once, ignoring accents and case", () => {
    assert.equal(withCity("123 Rue Principale", "Laval"), "123 Rue Principale, Laval");
    assert.equal(withCity("123 Rue Principale, Laval", "laval"), "123 Rue Principale, Laval");
    assert.equal(withCity("12 rue de Québec", "Quebec"), "12 rue de Québec");
    assert.equal(withCity("123 Rue Principale", undefined), "123 Rue Principale");
    assert.equal(withCity(undefined, "Laval"), undefined);
  });

  it("never replaces a complete address with an incomplete one", () => {
    assert.equal(mergeAddress("123 Rue Principale, Laval", "Laval"), "123 Rue Principale, Laval");
    assert.equal(mergeAddress("123 Rue Principale, Laval", "456 Boul. Saint-Martin"), "456 Boul. Saint-Martin");
    assert.equal(mergeAddress(undefined, "Laval"), "Laval");
    assert.equal(mergeAddress("123 Rue Principale, Laval", undefined), "123 Rue Principale, Laval");
  });

  it("confirmed details survive later calls that carry less", () => {
    const saved = mergeSlots(
      {} as never,
      cleanSlots({ callerName: "Jean Tremblay", serviceAddress: "123 Rue Principale, Laval", issue: "no heat" }),
    );
    const later = mergeSlots(saved, cleanSlots({ serviceAddress: "Laval", callerName: "" }));
    assert.equal(later.callerName, "Jean Tremblay");
    assert.equal(later.serviceAddress, "123 Rue Principale, Laval");
    assert.equal(later.issue, "no heat");
  });
});
