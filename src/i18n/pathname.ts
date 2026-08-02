import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** Server-safe pathname helpers — do not import client hooks from here. */
export const { getPathname } = createNavigation(routing);
