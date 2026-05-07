import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  err: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): State {
    return { err, info: null };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    this.setState({ err, info });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
  }

  reset = () => this.setState({ err: null, info: null });

  private getLang(): "ru" | "en" {
    try {
      const raw = JSON.parse(localStorage.getItem("pl_lang") || "{}");
      return (raw?.state?.lang as "ru" | "en") || "ru";
    } catch {
      return "ru";
    }
  }

  render() {
    const { err, info } = this.state;
    if (!err) return this.props.children;

    const lang = this.getLang();
    const labels =
      lang === "ru"
        ? {
            title: "Portfolio Lab — ошибка рендера",
            body: "Интерфейс упал во время отрисовки. Полный текст ошибки ниже — пришлите его, пожалуйста.",
            try_again: "Попробовать снова",
            reset: "Сбросить сессию и перелогиниться",
            comp_stack: "Стек компонентов:",
          }
        : {
            title: "Portfolio Lab — render error",
            body: "The UI crashed during rendering. The exact error message is below — please share it.",
            try_again: "Try again",
            reset: "Reset session and re-login",
            comp_stack: "Component stack:",
          };

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: "32px",
          color: "#FF3B5C",
          background: "#070A12",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 8, color: "#FF00AA" }}>{labels.title}</h1>
        <p style={{ color: "#8A92AB", marginBottom: 16 }}>{labels.body}</p>
        <pre
          style={{
            background: "#0F1424",
            border: "1px solid #1F2640",
            padding: 16,
            borderRadius: 12,
            overflow: "auto",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
            color: "#FF3B5C",
            whiteSpace: "pre-wrap",
          }}
        >
{err.name}: {err.message}
{"\n\n"}
{err.stack}
{info?.componentStack ? "\n\n" + labels.comp_stack + info.componentStack : ""}
        </pre>
        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <button
            onClick={this.reset}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid #00D4FF",
              background: "transparent",
              color: "#00D4FF",
              cursor: "pointer",
            }}
          >
            {labels.try_again}
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("pl_token");
              window.location.href = "/login";
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid #FF00AA",
              background: "transparent",
              color: "#FF00AA",
              cursor: "pointer",
            }}
          >
            {labels.reset}
          </button>
        </div>
      </div>
    );
  }
}
