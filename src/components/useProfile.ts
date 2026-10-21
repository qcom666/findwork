"use client";

import { useEffect, useState } from "react";

export type Profile = { name: string; skills: string; portfolio: string; priceFrom: string; contact: string };

export const EMPTY_PROFILE: Profile = { name: "", skills: "", portfolio: "", priceFrom: "", contact: "" };
const KEY = "findwork.profile";

/** Профиль фрилансера для питчей. Хранится только в браузере и общий для карточки лида и пакетных питчей. */
export function useProfile(): [Profile, (patch: Partial<Profile>) => void] {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setProfile({ ...EMPTY_PROFILE, ...JSON.parse(raw) });
    } catch {}
  }, []);

  function update(patch: Partial<Profile>) {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  return [profile, update];
}
