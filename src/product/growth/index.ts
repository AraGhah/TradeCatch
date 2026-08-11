import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { createGrowthServices } from "./services";
import { getGrowthStore } from "./runtime";

export function getGrowthServices() {
  return createGrowthServices({
    store: getGrowthStore(),
    sms: createTwilioSmsPort(),
  });
}

export {
  getGrowthStore,
  getGrowthRuntime,
  resetGrowthRuntimeForTests,
} from "./runtime";
export {
  createMemoryGrowthStore,
  type GrowthStore,
  type Appointment,
  type PipelineCard,
  type RevenueEvent,
  type ReviewRequest,
  type TimelineEvent,
  type PipelineStage,
} from "./memory-store";
export { createGrowthServices } from "./services";
