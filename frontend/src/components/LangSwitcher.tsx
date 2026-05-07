import { useLang } from "../i18n";

export default function LangSwitcher() {
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);

  return (
    <div className="flex items-center bg-bg-elevated border border-border rounded-lg p-0.5 text-[11px] font-mono">
      {(["ru", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2 py-1 rounded-md uppercase tracking-wider transition-colors ${
            lang === l
              ? "bg-cyan/15 text-cyan"
              : "text-text-dim hover:text-text"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
