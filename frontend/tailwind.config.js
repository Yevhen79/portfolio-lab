/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        // Extra-small breakpoint for mid-range phones (iPhone SE = 375 px,
        // Galaxy S24 = 360 px). Tailwind's default `sm:` (640 px) is too
        // wide for phone-only tweaks. `xs:` lights up at 420 px so the
        // larger phones (Pro/Pro Max, Ultra, 14+) get tighter copy than the
        // smallest devices but still smaller than tablet `sm:`.
        xs: "420px",
      },
      colors: {
        bg: {
          DEFAULT: "#070A12",
          surface: "#0F1424",
          elevated: "#171B2E",
          card: "rgba(23, 27, 46, 0.6)",
        },
        border: {
          DEFAULT: "#1F2640",
          accent: "#2A3358",
        },
        text: {
          DEFAULT: "#E5E9F4",
          muted: "#8A92AB",
          dim: "#5A627B",
        },
        // Accent colours are CSS-variable driven so the app can be re-skinned
        // per edition (full = cyan/magenta neon, libertex = red). The vars live
        // in index.css; [data-theme="libertex"] overrides them and the frontend
        // sets data-theme from /api/config on boot. RGB triplets so Tailwind's
        // /alpha opacity modifiers (cyan/20 etc.) keep working.
        cyan: {
          DEFAULT: "rgb(var(--color-cyan) / <alpha-value>)",
          glow: "rgb(var(--color-cyan) / 0.45)",
        },
        magenta: {
          DEFAULT: "rgb(var(--color-magenta) / <alpha-value>)",
          glow: "rgb(var(--color-magenta) / 0.45)",
        },
        green: {
          DEFAULT: "#00FF94",
          glow: "rgba(0, 255, 148, 0.4)",
        },
        red: {
          DEFAULT: "#FF3B5C",
          glow: "rgba(255, 59, 92, 0.4)",
        },
        amber: {
          DEFAULT: "#FFB300",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "Monaco", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px rgb(var(--color-cyan) / 0.25)",
        "glow-magenta": "0 0 40px rgb(var(--color-magenta) / 0.25)",
        "glow-green": "0 0 30px rgba(0, 255, 148, 0.3)",
        card: "0 8px 32px rgba(0, 0, 0, 0.4)",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgb(var(--color-cyan) / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-cyan) / 0.04) 1px, transparent 1px)",
        "neon-gradient":
          "linear-gradient(135deg, rgb(var(--color-cyan)) 0%, rgb(var(--color-magenta)) 100%)",
      },
      keyframes: {
        pulse_glow: {
          "0%, 100%": { boxShadow: "0 0 20px rgb(var(--color-cyan) / 0.3)" },
          "50%": { boxShadow: "0 0 40px rgb(var(--color-cyan) / 0.6)" },
        },
        slide_up: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-glow": "pulse_glow 2.5s ease-in-out infinite",
        "slide-up": "slide_up 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
