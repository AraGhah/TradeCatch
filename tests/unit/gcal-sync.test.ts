import { createHarness } from "./support/gcal-harness";
import { registerSyncScenarios } from "./gcal-scenarios";

// The in-memory store: fast, and the reference the SQL store must agree with.
registerSyncScenarios(async (options) => createHarness(options));
