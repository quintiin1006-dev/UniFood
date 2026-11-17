import { notFound } from "next/navigation";

import FeedbackGallery from "@/features/dev-feedback/FeedbackGallery";

// Development-only review page (ola 4 · F5, docs/ui-paneles.md). Production answers 404 and
// nothing in the app links here.
export const metadata = { robots: { index: false, follow: false } };

export default function DevFeedbackPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FeedbackGallery />;
}
