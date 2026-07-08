import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { en } from "./en";
import { ru } from "./ru";
import { useConfig } from "../store/config";

export type Strings = typeof en;
export type Lang = "en" | "ru";

const DICTS: Record<Lang, Strings> = { en, ru };

/**
 * Broker-token substitution for white-label editions.
 *
 * Shared i18n strings use a `{broker}` token wherever the broker name appears
 * as an adjective ("{broker}catalogue", "{broker}swap costs"). The token
 * expands to "Libertex " on the libertex edition and to "" on the full
 * (generic, broad-audience) edition — so the full build carries no broker
 * mentions while the libertex build reads "Libertex catalogue" etc.
 *
 * Substitution is deep + memoised per (lang, token) so `useT()` stays cheap
 * and existing `t.section.key` access is unchanged.
 */
const _brokerCache = new Map<string, Strings>();

/** Tidy the whitespace left behind when `{broker}` expands to "" — collapse
 *  double spaces and drop a space that ended up before punctuation or after
 *  an opening bracket/quote. Only applied to strings that had the token, so
 *  broker-free copy is never touched. Works for the broker as an English
 *  prefix ("full {broker} catalogue") and a Russian suffix
 *  ("каталог инструментов {broker}."). */
function tidy(s: string): string {
  return s
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,;:!?»)\]])/g, "$1")
    .replace(/([«([]) /g, "$1")
    .trim();
}

function substituteBroker(node: any, name: string): any {
  if (typeof node === "string") {
    if (!node.includes("{broker}")) return node;
    return tidy(node.replace(/\{broker\}/g, name));
  }
  if (Array.isArray(node)) return node.map((n) => substituteBroker(n, name));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const k in node) out[k] = substituteBroker(node[k], name);
    return out;
  }
  return node;
}

function dictFor(lang: Lang, brokerName: string): Strings {
  const key = `${lang}|${brokerName}`;
  let cached = _brokerCache.get(key);
  if (!cached) {
    cached = substituteBroker(DICTS[lang], brokerName) as Strings;
    _brokerCache.set(key, cached);
  }
  return cached;
}

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
  const brokerName = useConfig((s) => s.config?.broker_name ?? "");
  return useMemo(() => dictFor(lang, brokerName), [lang, brokerName]);
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
