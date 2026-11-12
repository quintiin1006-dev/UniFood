"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cafeteriaHref } from "../domain/context";
import { useClientCart } from "./ClientCartProvider";

/** Choosing another cafeteria asks before emptying a cart that belongs to a different one. */
export default function CafeteriaLink({
  cafeteriaId,
  children,
  className,
}: {
  cafeteriaId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const { chooseCafeteria, ready } = useClientCart();
  const href = cafeteriaHref(cafeteriaId);
  return (
    <Link
      className={className}
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (ready) chooseCafeteria(cafeteriaId, () => router.push(href));
      }}
    >
      {children}
    </Link>
  );
}
