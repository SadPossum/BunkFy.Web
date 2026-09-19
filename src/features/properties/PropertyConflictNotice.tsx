export function PropertyConflictNotice({ onRefresh, pending, actionLabel = "Edit details" }: {
  onRefresh: () => unknown;
  pending: boolean;
  actionLabel?: string;
}) {
  return <div role="alert" className="space-y-2 border-l-2 border-warning pl-3 text-sm">
    <p className="font-semibold">This property was changed elsewhere.</p>
    <p>Your draft is still here. Refresh to see the latest details above, then choose Cancel and {actionLabel} to start from the current version.</p>
    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { onRefresh(); }}>Refresh property</button>
  </div>;
}
