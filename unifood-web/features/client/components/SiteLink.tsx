"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClientCart } from "./ClientCartProvider";

export default function SiteLink({
  siteId,
  children,
  className,
}: {
  siteId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const { chooseSite, ready } = useClientCart();
  const href = `/cuenta?sede=${siteId}`;
  return (
    <Link
      className={className}
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (ready) chooseSite(siteId, () => router.push(href));
      }}
    >
      {children}
    </Link>
  );
}
