import { ShieldCheck } from "lucide-react";
import type { AdapterConflictPolicy } from "../../api/types";

export function ConflictPolicyNotice({ policy }: { policy: AdapterConflictPolicy }) {
  const normalized = typeof policy === "string" ? policy.toLowerCase() : policy;
  const suggestionsOnly = normalized === 1 || normalized === "suggestionsonly";
  const autoApply = normalized === 2 || normalized === "autoapplywhenadapterbaselineunchanged";

  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">
            {suggestionsOnly
              ? "Review changes to existing bookings"
              : autoApply
                ? "Apply changes against an unchanged source baseline"
                : "Review policy unavailable"}
          </p>
          <p className="mt-1 text-xs leading-5 text-base-content/65">
            {suggestionsOnly
              ? "Changes and cancellations to existing bookings wait for an authorized staff member to review and apply them."
              : autoApply
                ? "Changes and cancellations to existing bookings can apply automatically while the booking still matches the last accepted source revision. Conflicting updates need staff review."
                : "Refresh the connection settings to check how changes to existing bookings are handled."}
          </p>
          <p className="mt-2 text-xs leading-5 text-base-content/65">
            New bookings can be imported automatically under either policy.
          </p>
        </div>
      </div>
    </div>
  );
}
