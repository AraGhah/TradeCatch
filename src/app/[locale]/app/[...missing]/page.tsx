import { notFound } from "next/navigation";

/** Unknown /app/... paths must return HTTP 404, not a blank 200 page. */
export default function MissingAppPage() {
  notFound();
}
