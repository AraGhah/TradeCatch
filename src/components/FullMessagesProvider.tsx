import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/**
 * The root layout only ships the few namespaces the public pages need. The
 * signed-in workspace, admin console and login form use many more client-side
 * strings, so those routes opt back into the whole catalog here.
 */
export async function FullMessagesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await getMessages()}>
      {children}
    </NextIntlClientProvider>
  );
}
