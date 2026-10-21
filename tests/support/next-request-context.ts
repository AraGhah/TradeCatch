import "next/dist/server/node-environment-baseline";
import { createRequestStoreForAPI } from "next/dist/server/async-storage/request-store";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { createWorkStore } from "next/dist/server/async-storage/work-store";
import type { NextRequest } from "next/server";

/** Exercise real Next cookies/session validation without replacing the auth helper. */
export function withRequest<T>(request: NextRequest, run: () => T): T {
  const store = createRequestStoreForAPI(
    request,
    request.nextUrl,
    { tags: [], expirationsByCacheKind: new Map() },
    undefined,
    undefined,
    undefined,
  );
  // Only request APIs are exercised; no rendering/cache lifecycle is started.
  const work = createWorkStore({
    page: request.nextUrl.pathname + "/route",
    buildId: "test",
    deploymentId: "test",
    previouslyRevalidatedTags: [],
    renderOpts: {
      cacheLifeProfiles: { default: { stale: 0, revalidate: 0, expire: 0 } },
      staticPageGenerationTimeout: 60,
      cacheComponents: false,
      validationLevel: "warning",
      experimental: {
        authInterrupts: false,
        useCacheTimeout: 60,
        durableUseCacheEntries: false,
      },
      assetPrefix: "",
      isBuildTimePrerendering: false,
      isDraftMode: false,
      isDebugDynamicAccesses: false,
      waitUntil: undefined,
      onClose: () => {},
      onAfterTaskError: undefined,
    },
  });
  return workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, run));
}
