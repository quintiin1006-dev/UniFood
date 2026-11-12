"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { cafeteriaHref } from "../domain/context";
import { cacheCafeteria, readCachedCafeteria } from "../state";

/** Remembers the cafeteria shown on Inicio. Browser cache only: the server revalidates it. */
export function RememberCafeteria({
  ownerId,
  cafeteriaId,
}: {
  ownerId: string;
  cafeteriaId: string;
}) {
  useEffect(() => {
    cacheCafeteria(ownerId, cafeteriaId);
  }, [ownerId, cafeteriaId]);
  return null;
}

/**
 * On the selection screen, returns to the cached cafeteria if the context still lists it.
 * The page that follows validates it again on the server.
 */
export function RestoreCafeteria({
  ownerId,
  allowed,
}: {
  ownerId: string;
  allowed: string[];
}) {
  const router = useRouter();
  const key = allowed.join(",");
  useEffect(() => {
    const cached = readCachedCafeteria(ownerId);
    if (cached && key.split(",").includes(cached))
      router.replace(cafeteriaHref(cached));
  }, [ownerId, key, router]);
  return null;
}
