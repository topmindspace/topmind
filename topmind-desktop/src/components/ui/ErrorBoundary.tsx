// ── ErrorBoundary — catches render errors in a subtree, shows fallback ─────
// Prevents a single component crash (e.g., infinite-loop in ViewSwitcher)
// from taking down the entire app. The user can retry to re-mount the tree.
import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { ICON } from "../../lib/icons";
import i18n from "../../locales";

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback UI */
  label?: string;
  /** Called when the user clicks retry — useful for resetting parent state */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  /** Incremented on each retry to force remount of children */
  retryKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  handleRetry = () => {
    this.props.onReset?.();
    this.setState((prev) => ({ error: null, retryKey: prev.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-status-error-bg/50 text-error">
            <AlertCircle size={ICON.sm} />
          </div>
          <div className="text-3xs font-medium text-text-secondary">
            {this.props.label || i18n.t("common:errorBoundary.title")}
          </div>
          <div className="max-w-[16rem] text-4xs leading-relaxed text-text-quaternary">
            {this.state.error.message || i18n.t("common:errorBoundary.message")}
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-1 inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle px-2.5 py-1 text-3xs font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            <RefreshCw size={ICON.nano} aria-hidden />
            {i18n.t("common:action.retry")}
          </button>
        </div>
      );
    }
    // key forces remount on retry — clears stale state that caused the error
    return (
      <div key={this.state.retryKey} className="contents">
        {this.props.children}
      </div>
    );
  }
}
