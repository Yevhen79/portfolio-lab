import { create } from "zustand";
import { persist } from "zustand/middleware";

import { en } from "./en";
import { ru } from "./ru";

export type Strings = typeof en;
export type Lang = "en" | "ru";

const DICTS: Record<Lang, Strings> = { en, ru };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<I18nState>()(
  persist(
    (set) => ({
      lang: "ru",
      setLang: (l) => set({ lang: l }),
    }),
    { name: "pl_lang" },
  ),
);

/**
 * `t` returns the dictionary for the currently selected language.
 * Re-renders consumers via Zustand subscription.
 *
 * Usage:
 *   const t = useT();
 *   <h1>{t.builder.page_title}</h1>
 */
export function useT(): Strings {
  const lang = useLang((s) => s.lang);
  return DICTS[lang];
}

/**
 * Replace `{key}` placeholders inside a template string with values from
 * `vars`. Missing keys are left unchanged.
 *
 *   tpl("Hello {who}", { who: "world" }) -> "Hello world"
 */
export function tpl(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}
