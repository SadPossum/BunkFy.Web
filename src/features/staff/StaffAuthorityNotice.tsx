import { ShieldAlert } from "lucide-react";

export function StaffAuthorityNotice({ message }: { message: string }) {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <ShieldAlert className="shrink-0 text-warning" size={18} />
      <p className="text-sm leading-5">{message}</p>
    </div>
  );
}
