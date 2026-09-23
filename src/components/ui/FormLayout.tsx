import { useId, type ReactNode, type Ref } from "react";

type LayoutProps = { children: ReactNode; className?: string };

/** Explicit composition only: callers keep field order, state and action ownership. */
export function FormSection({ title, description, icon, headingLevel = 3, headingRef, children, className = "" }: LayoutProps & {
  title?: string;
  description?: string;
  icon?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section aria-labelledby={title ? headingId : undefined} className={`min-w-0 py-5 first:pt-0 last:pb-0 ${className}`}>
      {(title || description) && <div className="mb-4 min-w-0">
        {title && <Heading id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}
          className="flex min-w-0 items-start gap-2 rounded text-base font-semibold leading-6 [overflow-wrap:anywhere] outline-none focus:ring-2 focus:ring-primary">
          {icon && <span aria-hidden="true" className="mt-1 shrink-0 text-primary">{icon}</span>}
          <span className="min-w-0">{title}</span>
        </Heading>}
        {description && <p className="mt-1 max-w-prose text-sm leading-5 text-base-content/65 [overflow-wrap:anywhere]">{description}</p>}
      </div>}
      {children}
    </section>
  );
}

export function FormGrid({ children, layout = "balanced", className = "" }: LayoutProps & { layout?: "balanced" | "primaryCompact" }) {
  return <div className={`grid min-w-0 grid-cols-1 items-start gap-4 [&>*]:min-w-0 ${layout === "primaryCompact" ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]" : "sm:grid-cols-2"} ${className}`}>{children}</div>;
}

export function FormSpan({ children, className = "" }: LayoutProps) {
  return <div className={`col-span-full min-w-0 ${className}`}>{children}</div>;
}

export function DetailColumns({ children, className = "" }: LayoutProps) {
  return <div className={`grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8 [&>*]:min-w-0 ${className}`}>{children}</div>;
}
