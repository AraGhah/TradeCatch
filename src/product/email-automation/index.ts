export type {
  EmailTemplate,
  EmailSequence,
  EmailEnrollment,
  SequenceStep,
  EmailPort,
  OutboundEmail,
} from "./types";
export {
  renderTemplate,
  validateTemplate,
  parseTemplate,
  TemplateSyntaxError,
} from "./template";
export {
  createEmailAutomationServices,
  defaultTemplates,
  EmailAutomationError,
  type EmailAutomationServices,
} from "./services";
export {
  createMemoryEmailAutomationStore,
  type EmailAutomationStore,
} from "./store";
export { createPostgresEmailAutomationStore } from "./postgres-store";
export { createMemoryEmailPort, createResendEmailPort } from "./email-port";
export { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";
