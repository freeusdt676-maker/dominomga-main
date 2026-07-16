import { Component, ReactNode } from "react";

type State = { hasError: boolean; message?: string };

// Errors that are caused by browser translation extensions (Google Translate,
// Chrome auto-translate, etc.) racing with React's reconciler. They are
// transient — the tree is fine after a re-render, so we should never block
// the whole app with a modal for them.
const TRANSIENT_DOM_ERRORS = [
  "removeChild",
  "insertBefore",
  "The node to be removed is not a child of this node",
  "The node before which the new node is to be inserted is not a child of this node",
];

function isTransientDomError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? String(err ?? "");
  return TRANSIENT_DOM_ERRORS.some((needle) => msg.includes(needle));
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: Error): State {
    if (isTransientDomError(err)) {
      // Silently recover — do NOT show the fullscreen fallback.
      return { hasError: false };
    }
    return { hasError: true, message: err?.message ?? "Nisy tsy fetezana" };
  }

  componentDidCatch(err: Error, info: unknown) {
    if (isTransientDomError(err)) {
      // Force a clean re-render on the next tick to flush the stale nodes.
      // eslint-disable-next-line no-console
      console.warn("[AppErrorBoundary] transient DOM error swallowed:", err?.message);
      queueMicrotask(() => {
        try { this.forceUpdate(); } catch { /* noop */ }
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", err, info);
  }

  reset = () => {
    this.setState({ hasError: false, message: undefined });
    try { window.location.reload(); } catch {}
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a2818] text-[#ffe27a] p-6">
        <div className="max-w-md text-center space-y-4 bg-[#0d3b22] border-2 border-[#d4a52c]/60 rounded-2xl p-6 shadow-2xl">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-black">Nisy olana kely</h1>
          <p className="text-sm text-[#ffe27a]/80 break-words">{this.state.message}</p>
          <button
            onClick={this.reset}
            className="px-5 py-2.5 rounded-full bg-[#d4a52c] text-[#0a2818] font-bold active:scale-95"
          >
            Averina alefa ny app
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;