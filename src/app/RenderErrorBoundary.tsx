import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Link } from "react-router";

type RenderErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: string;
};

export type RenderErrorBoundaryState = {
  failed: boolean;
  resetKey: string | null;
};

export function deriveRenderErrorBoundaryReset(
  state: RenderErrorBoundaryState,
  resetKey: string | undefined,
): Partial<RenderErrorBoundaryState> | null {
  const normalizedResetKey = resetKey ?? null;
  if (normalizedResetKey === state.resetKey) return null;
  return {
    failed: false,
    resetKey: normalizedResetKey,
  };
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  public state: RenderErrorBoundaryState = {
    failed: false,
    resetKey: this.props.resetKey ?? null,
  };

  public static getDerivedStateFromError(): Partial<RenderErrorBoundaryState> {
    return { failed: true };
  }

  public static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    return deriveRenderErrorBoundaryReset(state, props.resetKey);
  }

  public render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function RouteRenderFailure() {
  return (
    <section
      className="grid min-h-[55vh] place-items-center py-12"
      role="alert"
    >
      <div className="max-w-lg text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-warning/15 text-warning-content">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold">
          This page could not be opened
        </h1>
        <p className="mt-2 text-sm leading-6 text-base-content/55">
          Reload to fetch the latest application files, or return to the overview.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            <RotateCcw size={17} />
            Reload page
          </button>
          <Link className="btn btn-ghost" to="/">
            <Home size={17} />
            Overview
          </Link>
        </div>
      </div>
    </section>
  );
}

export function ApplicationRenderFailure() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-base-200 p-6"
      role="alert"
    >
      <div className="max-w-lg text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-warning/15 text-warning-content">
          <AlertTriangle size={22} />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold">
          BunkFy needs to reload
        </h1>
        <p className="mt-2 text-sm leading-6 text-base-content/55">
          Reload the application to restore your workspace session.
        </p>
        <button
          type="button"
          className="btn btn-primary mt-6"
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={17} />
          Reload BunkFy
        </button>
      </div>
    </main>
  );
}
