import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referralSubmissionSchema } from "../../src/lib/validation/referral-submission";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    referrerName: "Sam Tremblay",
    referrerEmail: "sam@example.test",
    referralCode: "",
    contactName: "Alex Roy",
    businessName: "Roy Plomberie",
    contactEmail: "",
    contactPhone: "514-555-0187",
    note: "",
    language: "en",
    permissionConfirmed: true,
    companyWebsite: "",
    turnstileToken: "token",
    ...overrides,
  };
}

describe("referral submission schema", () => {
  it("accepts a referral with a phone number only", () => {
    assert.equal(referralSubmissionSchema.safeParse(valid()).success, true);
  });

  it("accepts a referral with an email only", () => {
    const result = referralSubmissionSchema.safeParse(
      valid({ contactPhone: "", contactEmail: "alex@example.test" }),
    );
    assert.equal(result.success, true);
  });

  it("requires a way to reach the person being referred", () => {
    const result = referralSubmissionSchema.safeParse(
      valid({ contactPhone: "", contactEmail: "" }),
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((i) => i.message === "contact_required"),
      );
    }
  });

  it("requires the referrer to confirm they have permission", () => {
    assert.equal(
      referralSubmissionSchema.safeParse(valid({ permissionConfirmed: false }))
        .success,
      false,
    );
    const { permissionConfirmed: _omitted, ...rest } = valid();
    void _omitted;
    assert.equal(referralSubmissionSchema.safeParse(rest).success, false);
  });

  it("rejects malformed emails, phones and referral codes", () => {
    for (const overrides of [
      { referrerEmail: "not-an-email" },
      { contactEmail: "nope" },
      { contactPhone: "call me maybe" },
      { contactPhone: "123" },
      // 0, O, 1, I and L are not in the code alphabet.
      { referralCode: "0OIL1AAAAA" },
      { referralCode: "SHORT" },
    ]) {
      assert.equal(
        referralSubmissionSchema.safeParse(valid(overrides)).success,
        false,
        JSON.stringify(overrides),
      );
    }
  });

  it("accepts a well-formed referral code in either case", () => {
    for (const referralCode of ["ABCDEFGHJK", "abcdefghjk"]) {
      assert.equal(
        referralSubmissionSchema.safeParse(valid({ referralCode })).success,
        true,
        referralCode,
      );
    }
  });

  it("requires names and a bot-check token, and bounds free text", () => {
    for (const overrides of [
      { referrerName: "   " },
      { contactName: "" },
      { businessName: "" },
      { turnstileToken: "" },
      { note: "x".repeat(501) },
      { language: "de" },
    ]) {
      assert.equal(
        referralSubmissionSchema.safeParse(valid(overrides)).success,
        false,
        JSON.stringify(overrides),
      );
    }
  });

  it("defaults the honeypot to empty and trims whitespace", () => {
    const { companyWebsite: _omitted, ...rest } = valid({
      referrerName: "  Sam Tremblay  ",
    });
    void _omitted;
    const result = referralSubmissionSchema.safeParse(rest);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.companyWebsite, "");
      assert.equal(result.data.referrerName, "Sam Tremblay");
    }
  });
});
