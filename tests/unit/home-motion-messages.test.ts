import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";

/**
 * The home page's before/after cards, call-flow diagram and missed-call
 * simulator pair their strings by position: a recovered timeline per leak
 * card, a packet label per system step, a weekday per calendar column. A
 * missing or extra entry would silently show the wrong line, so the shapes
 * are pinned here in both languages.
 */
for (const [locale, messages] of [
  ["en", en],
  ["fr", fr],
] as const) {
  const home = messages.home;
  const sim = messages.demoStories.simulator;

  test(`${locale}: one recovered timeline of three lines per leak card`, () => {
    assert.equal(home.lossRecovery.saved.length, home.leaks.cards.length);
    for (const lines of home.lossRecovery.saved) {
      assert.equal(lines.length, 3);
      for (const line of lines) assert.ok(line.trim());
    }
  });

  test(`${locale}: one packet label per system step, three nodes`, () => {
    assert.equal(home.signalFlow.packets.length, home.system.steps.length);
    assert.equal(home.signalFlow.nodes.length, 3);
  });

  test(`${locale}: simulator trades, weekdays and statuses are complete`, () => {
    assert.deepEqual(
      sim.trades.map((t) => t.id),
      ["plumbing", "electrical", "heating"],
    );
    for (const t of sim.trades) {
      assert.ok(t.label && t.ask && t.service);
    }
    assert.equal(sim.days.length, 5);
    for (const key of [
      "ringing",
      "missed",
      "texted",
      "replied",
      "captured",
      "booked",
      "request",
    ] as const) {
      assert.ok(sim.status[key], `status.${key}`);
    }
  });
}
