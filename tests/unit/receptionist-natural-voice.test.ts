import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLocation,
  detectNameInSentence,
  detectStreetAddress,
  detectProject,
  detectTrades,
  detectWhen,
  extractCallDetails,
  serviceOffered,
  tradeLabel,
  tradeScopeQuestion,
} from "../../src/product/receptionist/call-details";
import {
  detectLanguageSwitch,
  firstLanguage,
  isGreetingOnly,
  languageForDigits,
  languageSelectTimeoutSeconds,
  looksEnglish,
  splitGreeting,
} from "../../src/product/receptionist/language-select";
import {
  extractName,
  isSmallTalk,
  matchesOffTopic,
} from "../../src/product/receptionist/nlu";
import {
  claimsToBeHuman,
  claimsUnapprovedPrice,
} from "../../src/product/receptionist/reply-guards";
import {
  BASE_RATE_PERCENT,
  escapeSsmlText,
  isCarefulSentence,
  ratePercent,
  spacePostalCodes,
  ssmlEnabled,
  toSpeechMarkup,
  voiceSupportsSsml,
} from "../../src/product/receptionist/speech-style";
import { gatherTuning } from "../../src/product/receptionist/voice";

describe("language selection", () => {
  it("starts every bilingual call in French and an English-only line in English", () => {
    assert.equal(firstLanguage(["en", "fr"], "en"), "fr");
    assert.equal(firstLanguage(["fr", "en"], "en"), "fr");
    assert.equal(firstLanguage(["en"], "fr"), "en");
    assert.equal(firstLanguage(["fr"], "en"), "fr");
  });

  it("reads only a lone 1 (English) or 2 (French) as a menu choice", () => {
    assert.equal(languageForDigits("1"), "en");
    assert.equal(languageForDigits("2"), "fr");
    assert.equal(languageForDigits(" 2 "), "fr");
    for (const other of ["", undefined, "3", "0", "12", "11", "#", "*", "abc"]) {
      assert.equal(languageForDigits(other), null, String(other));
    }
  });

  it("keeps the no-key wait inside a safe range", () => {
    assert.equal(languageSelectTimeoutSeconds({}), 3);
    assert.equal(languageSelectTimeoutSeconds({ RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS: "5" }), 5);
    assert.equal(languageSelectTimeoutSeconds({ RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS: "1" }), 2);
    assert.equal(languageSelectTimeoutSeconds({ RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS: "99" }), 10);
    assert.equal(languageSelectTimeoutSeconds({ RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS: "abc" }), 3);
    assert.equal(languageSelectTimeoutSeconds({ RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS: "0" }), 3);
  });

  it("recognizes a spoken request to change language", () => {
    for (const phrase of [
      "in English please",
      "English",
      "Can you speak English?",
      "je préfère l'anglais",
      "I don't speak French",
      "je ne parle pas français",
    ]) {
      assert.equal(detectLanguageSwitch(phrase), "en", phrase);
    }
    for (const phrase of [
      "en français s'il vous plaît",
      "français",
      "Could you continue in French?",
      "I don't speak English",
      "je ne parle pas anglais",
    ]) {
      assert.equal(detectLanguageSwitch(phrase), "fr", phrase);
    }
  });

  it("does not mistake ordinary speech for a language choice", () => {
    for (const phrase of [
      "",
      "my kitchen needs painting",
      "I need a French drain installed",
      "j'ai une fuite d'eau",
      "ok",
      "umm",
    ]) {
      assert.equal(detectLanguageSwitch(phrase), null, phrase);
    }
  });

  it("treats a bare hello as not yet answering the opening question", () => {
    for (const hello of ["Bonjour", "allo?", "hello hi", "", "oui", "Bonjour, allô"]) {
      assert.equal(isGreetingOnly(hello), true, hello);
    }
    for (const real of ["I need a plumber", "bonjour j'ai une fuite", "my sink leaks"]) {
      assert.equal(isGreetingOnly(real), false, real);
    }
  });

  it("splits a trailing question off an owner-written greeting", () => {
    assert.deepEqual(
      splitGreeting("Bonjour! Merci d'avoir appelé Acme. Comment puis-je vous aider?"),
      {
        statement: "Bonjour! Merci d'avoir appelé Acme.",
        question: "Comment puis-je vous aider?",
      },
    );
    assert.deepEqual(splitGreeting("Hello, thanks for calling."), {
      statement: "Hello, thanks for calling.",
    });
    assert.deepEqual(splitGreeting("How can I help?"), {
      statement: "",
      question: "How can I help?",
    });
    assert.equal(splitGreeting("  Hi   there.  ").statement, "Hi there.");
  });
});

describe("understanding a caller's sentence", () => {
  it("captures several details from one sentence", () => {
    const d = extractCallDetails(
      "Hi, my name is John. I need someone to paint my kitchen next Thursday. I'm in Laval",
      "en",
    );
    assert.equal(d.callerName, "John");
    assert.equal(d.tradeKey, "painting");
    assert.equal(d.service, tradeLabel("painting", "en"));
    assert.equal(d.project, "kitchen");
    assert.match(d.preferredTime ?? "", /next thursday/i);
    assert.equal(d.location, "Laval");
  });

  it("does the same in French", () => {
    const d = extractCallDetails(
      "Bonjour, je m'appelle Marie Tremblay, je voudrais faire peindre la cuisine demain matin à Laval",
      "fr",
    );
    assert.equal(d.callerName, "Marie Tremblay");
    assert.equal(d.tradeKey, "painting");
    assert.equal(d.project, "la cuisine");
    assert.match(d.preferredTime ?? "", /demain matin/i);
    assert.equal(d.location, "Laval");
  });

  it("finds an email address and leaves unknown fields out", () => {
    const d = extractCallDetails("écrivez-moi à marie@example.com", "fr");
    assert.equal(d.email, "marie@example.com");
    assert.equal("callerName" in d, false);
    assert.equal("tradeKey" in d, false);
  });

  it("does not read how long a problem has lasted as the time the caller wants", () => {
    assert.equal(detectWhen("j'ai une fuite depuis ce matin"), undefined);
    assert.equal(detectWhen("it has been leaking since yesterday"), undefined);
    assert.match(detectWhen("can you come tomorrow morning") ?? "", /tomorrow morning/i);
  });

  it("recognizes trades and asks a scope question that fits each one", () => {
    assert.ok(detectTrades("peinturer le salon").strong.includes("painting"));
    assert.ok(detectTrades("my toilet is leaking").any.includes("plumbing"));
    for (const key of ["painting", "plumbing", "roofing", "electrical"] as const) {
      for (const lang of ["fr", "en"] as const) {
        assert.match(tradeScopeQuestion(key, lang) ?? "", /\?$/, `${key}/${lang}`);
      }
    }
  });

  it("keeps the count when a caller says how many rooms", () => {
    assert.equal(detectProject("three bedrooms", "en"), "three bedrooms");
    assert.equal(detectProject("3 chambres à peindre", "fr"), "3 chambres");
    assert.equal(detectProject("the basement", "fr"), "le sous-sol");
    assert.equal(detectProject("hello", "en"), undefined);
  });

  it("finds a place by name, or a capitalised word after 'in'/'à'", () => {
    assert.equal(detectLocation("I live in Brossard"), "Brossard");
    assert.equal(detectLocation("chez moi à Saint-Basile"), "Saint-Basile");
    assert.equal(detectLocation("my area is covered", ["Rive-Sud"]), undefined);
    assert.equal(detectLocation("on Monday", []), undefined);
    assert.equal(detectLocation("we are out in Sorel", ["Sorel"]), "Sorel");
  });

  it("finds a name only when it is introduced as one", () => {
    assert.equal(detectNameInSentence("Hi, my name is John. I need a plumber"), "John");
    assert.equal(detectNameInSentence("this is Marie Tremblay calling"), "Marie Tremblay");
    assert.equal(detectNameInSentence("I'm calling about a leak"), undefined);
    assert.equal(detectNameInSentence("my sink is leaking"), undefined);
  });

  it("only says a service is not offered when it is sure", () => {
    const owned = ["Painting", "Drywall repair"];
    assert.deepEqual(serviceOffered("I need my roof redone", owned), {
      offered: false,
      requested: "roofing",
    });
    assert.equal(serviceOffered("paint my kitchen", owned).offered, true);
    assert.equal(serviceOffered("I need my roof redone", []).offered, true);
    // Nothing recognisable in the owner's list: never refuse a caller.
    assert.equal(serviceOffered("I need my roof redone", ["Custom stuff"]).offered, true);
    assert.deepEqual(serviceOffered("something unusual", owned), {
      offered: true,
      requested: undefined,
    });
  });
});

describe("speech pacing", () => {
  const POLLY = "Polly.Gabrielle-Neural";

  it("escapes plain-voice text and adds no tags", () => {
    const out = toSpeechMarkup("Tom & Jerry <b>\"hi\"", "alice", { ssml: true });
    assert.equal(out, "Tom &amp; Jerry &lt;b&gt;&quot;hi&quot;");
  });

  it("adds a calm rate on neural voices and a slower one for numbers", () => {
    const out = toSpeechMarkup(
      "Très bien. Votre numéro est le 5 1 4, 5 5 5, 0 1 9 9.",
      POLLY,
      { ssml: true },
    );
    assert.match(out, /<prosody rate="96%">Très bien\.<\/prosody>/);
    assert.match(out, /<prosody rate="86%">Votre numéro/);
    assert.match(out, /<break time="280ms"\/>/, "a pause between digit groups");
  });

  it("pauses briefly after a short acknowledgement", () => {
    const out = toSpeechMarkup("D'accord. Quelle est votre adresse?", POLLY, { ssml: true });
    assert.match(out, /D&apos;accord\.<\/prosody>\s*<break time="140ms"\/>/);
  });

  it("follows the owner's speaking-speed setting", () => {
    assert.equal(ratePercent("slow", false), BASE_RATE_PERCENT.slow);
    assert.equal(ratePercent("fast", false), BASE_RATE_PERCENT.fast);
    assert.equal(ratePercent(undefined, false), BASE_RATE_PERCENT.normal);
    assert.ok(ratePercent("slow", true) < ratePercent("slow", false));
    assert.match(toSpeechMarkup("Bonjour.", POLLY, { ssml: true, speed: "slow" }), /rate="88%"/);
  });

  it("produces balanced tags and never lets caller text inject markup", () => {
    const hostile = 'Merci </prosody></speak><break time="9s"/> "x" & <y>. Une autre phrase.';
    const out = toSpeechMarkup(hostile, POLLY, { ssml: true });
    assert.equal((out.match(/<prosody/g) ?? []).length, (out.match(/<\/prosody>/g) ?? []).length);
    assert.doesNotMatch(out, /<break time="9s"/);
    assert.doesNotMatch(out, /<\/speak>/);
    assert.doesNotMatch(out, /<y>/);
  });

  it("falls back to escaped plain text when SSML is off or the voice cannot use it", () => {
    assert.equal(toSpeechMarkup("Bonjour. Merci.", POLLY, { ssml: false }), "Bonjour. Merci.");
    assert.equal(toSpeechMarkup("Bonjour. Merci.", "alice", { ssml: true }), "Bonjour. Merci.");
    assert.equal(ssmlEnabled({ RECEPTIONIST_SSML: "0" }), false);
    assert.equal(ssmlEnabled({}), true);
    assert.equal(voiceSupportsSsml("Polly.Gabrielle-Neural"), true);
    assert.equal(voiceSupportsSsml("Google.fr-CA-Neural2-A"), true);
    assert.equal(voiceSupportsSsml("alice"), false);
  });

  it("spells out Canadian postal codes and spots sentences that need care", () => {
    assert.equal(spacePostalCodes("H2X 1Y4"), "H 2 X, 1 Y 4");
    assert.equal(spacePostalCodes("j3e-4k5"), "J 3 E, 4 K 5");
    assert.equal(isCarefulSentence("Rendez-vous à 14 h 30"), true);
    assert.equal(isCarefulSentence("Le 514 555 0199"), true);
    assert.equal(isCarefulSentence("Merci beaucoup"), false);
    assert.equal(escapeSsmlText("a&b"), "a&amp;b");
  });
});

describe("what the AI is allowed to say", () => {
  it("blocks an amount the owner never approved", () => {
    assert.equal(claimsUnapprovedPrice("Ça coûte environ 500 $", undefined), true);
    assert.equal(claimsUnapprovedPrice("It would be about 200 dollars", "from $150"), true);
    assert.equal(claimsUnapprovedPrice("Nos tarifs sont de 95$ l'heure", "À partir de 150 $"), true);
    assert.equal(claimsUnapprovedPrice("C'est 1 200 $ en moyenne", undefined), true);
    assert.equal(claimsUnapprovedPrice("About 300 CAD for that", undefined), true);
  });

  it("reads the owner's wording the same way however the amount is written", () => {
    assert.equal(claimsUnapprovedPrice("À partir de 150$", "From $150 an hour"), false);
    assert.equal(claimsUnapprovedPrice("From $150 an hour", "À partir de 150 $ l'heure"), false);
  });

  it("allows an amount that is the owner's own wording, and replies with no amount", () => {
    assert.equal(
      claimsUnapprovedPrice("Estimates are free, from $150 an hour", "Estimates are free; from $150 an hour"),
      false,
    );
    assert.equal(claimsUnapprovedPrice("Ça dépend du projet, je peux planifier une estimation.", undefined), false);
    assert.equal(claimsUnapprovedPrice("Rendez-vous demain à 10 h", undefined), false);
  });

  it("blocks a claim to be a person or to not be automated", () => {
    for (const reply of [
      "I'm a real person, don't worry",
      "No, I am not a robot",
      "Je suis une vraie personne",
      "Je ne suis pas un robot",
    ]) {
      assert.equal(claimsToBeHuman(reply), true, reply);
    }
    for (const reply of [
      "I'm the virtual receptionist for Acme.",
      "Je suis l'assistante virtuelle de Acme.",
      "I can take a message for the team.",
    ]) {
      assert.equal(claimsToBeHuman(reply), false, reply);
    }
  });
});

describe("Twilio speech-recognition tuning", () => {
  it("has safe defaults", () => {
    assert.deepEqual(gatherTuning({}), {
      speechModel: undefined,
      enhanced: undefined,
      speechTimeout: "auto",
      profanityFilter: false,
      timeoutSeconds: 6,
    });
  });

  it("applies valid settings from the environment", () => {
    assert.deepEqual(
      gatherTuning({
        RECEPTIONIST_GATHER_SPEECH_MODEL: "phone_call",
        RECEPTIONIST_GATHER_ENHANCED: "1",
        RECEPTIONIST_GATHER_SPEECH_TIMEOUT: "3",
        RECEPTIONIST_GATHER_PROFANITY_FILTER: "1",
        RECEPTIONIST_GATHER_TIMEOUT_SECONDS: "8",
      }),
      {
        speechModel: "phone_call",
        enhanced: true,
        speechTimeout: "3",
        profanityFilter: true,
        timeoutSeconds: 8,
      },
    );
  });

  it("ignores values Twilio would reject", () => {
    const t = gatherTuning({
      RECEPTIONIST_GATHER_SPEECH_MODEL: "made_up_model",
      RECEPTIONIST_GATHER_SPEECH_TIMEOUT: "45",
      RECEPTIONIST_GATHER_TIMEOUT_SECONDS: "1",
    });
    assert.equal(t.speechModel, undefined);
    assert.equal(t.speechTimeout, "auto");
    assert.equal(t.timeoutSeconds, 6);
  });
});


describe("who is speaking: names, addresses, language, chit-chat", () => {
  it("takes a name only when the caller actually gave one", () => {
    assert.equal(extractName("Marie Tremblay"), "Marie Tremblay");
    assert.equal(extractName("my name is John Smith"), "John Smith");
    // Surname particles stay part of the name (capitalisation is cosmetic).
    assert.match(
      extractName("c'est Jean-François de la Durantaye") ?? "",
      /^Jean-François de la Durantaye$/i,
    );
    for (const notAName of [
      "oui",
      "yes",
      "non merci",
      "my sink is leaking",
      "do you like hockey",
      "j'ai une fuite",
      "uh",
      "12 rue des Pins",
    ]) {
      assert.equal(extractName(notAName), null, notAName);
    }
  });

  it("finds a street address inside a sentence, French or English", () => {
    assert.equal(detectStreetAddress("I'm at 123 Main Street in Laval"), "123 Main Street");
    assert.equal(detectStreetAddress("non, c'est 45 rue Principale"), "45 rue Principale");
    assert.equal(detectStreetAddress("12 rue des Pins à Laval"), "12 rue des Pins");
    assert.equal(detectStreetAddress("5 Elm Avenue"), "5 Elm Avenue");
  });

  it("does not mistake other numbers or a bare street type for an address", () => {
    assert.equal(detectStreetAddress("12 rue"), undefined);
    assert.equal(detectStreetAddress("I have 3 leaks in the street"), undefined);
    assert.equal(detectStreetAddress("my number is 514 555 9876"), undefined);
    assert.equal(detectStreetAddress(""), undefined);
  });

  it("recognises English and leaves French alone", () => {
    assert.equal(looksEnglish("Hi, I need a plumber for my basement"), true);
    assert.equal(looksEnglish("Hello, do you have time this week?"), true);
    assert.equal(looksEnglish("Bonjour, j'ai besoin d'un plombier"), false);
    assert.equal(looksEnglish("oui"), false);
    assert.equal(looksEnglish("plumber"), false, "one word is not enough");
    assert.equal(looksEnglish(""), false);
  });

  it("separates trivia from questions about the business", () => {
    assert.equal(matchesOffTopic("do you like hockey?"), true);
    assert.equal(matchesOffTopic("tell me a joke"), true);
    assert.equal(matchesOffTopic("who won the game last night"), true);
    assert.equal(matchesOffTopic("how much for a faucet"), false);
    assert.equal(matchesOffTopic("do you do bathrooms"), false);
    assert.equal(matchesOffTopic(""), false);
  });

  it("answers small talk briefly", () => {
    assert.equal(isSmallTalk("how are you?"), true);
    assert.equal(isSmallTalk("Bonjour, comment allez-vous"), true);
    assert.equal(isSmallTalk("how are you going to fix my sink"), false);
    assert.equal(isSmallTalk("I need a plumber"), false);
  });
});
