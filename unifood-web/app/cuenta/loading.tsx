import { UniFoodLoader } from "@/components/ui/UniFoodLoader";

// Route transition inside the client layout: the header and tabs stay, the loader appears after 300 ms.
export default function ClientLoading() {
  return <UniFoodLoader inline />;
}
