import { UniFoodLoader } from "@/components/ui/UniFoodLoader";

// Route transition inside the admin layout: sidebar stays, the loader appears after 300 ms.
export default function AdminLoading() {
  return <UniFoodLoader inline />;
}
