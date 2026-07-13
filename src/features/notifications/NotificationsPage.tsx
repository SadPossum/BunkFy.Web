import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Bell, Check, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Info, Megaphone, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { notificationAudienceLabel, notificationSeverityLabel } from "../../api/labels";
import type { MarkAllNotificationsReadResponse, NotificationBroadcastItem, NotificationBroadcastListResponse, NotificationHistoryItem, NotificationHistoryListResponse, NotificationSeverity } from "../../api/types";
import { useSession } from "../../app/session";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusBadge } from "../../components/ui/primitives";

const PAGE_SIZE = 25;
type InboxTab = "personal" | "broadcasts";

export function NotificationsPage() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<InboxTab>("personal");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tab, unreadOnly]);
  const kind = tab === "personal" ? "history" : "broadcasts";
  const path = tab === "personal" ? "/api/notifications" : "/api/notifications/broadcasts";
  const query = useQuery({
    queryKey: ["notifications", kind, "list", page, unreadOnly],
    queryFn: () => request<NotificationHistoryListResponse | NotificationBroadcastListResponse>(`${path}?page=${page}&pageSize=${PAGE_SIZE}&unreadOnly=${unreadOnly}`),
  });
  const markAll = useMutation({
    mutationFn: () => request<MarkAllNotificationsReadResponse>(`${path}/read-all`, { method: "POST" }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["notifications", kind] }); },
  });
  function select(item: NotificationHistoryItem | NotificationBroadcastItem | null) {
    const next = new URLSearchParams(searchParams);
    next.delete("notification"); next.delete("broadcast");
    if (item) next.set(tab === "personal" ? "notification" : "broadcast", notificationId(item));
    setSearchParams(next, { replace: true });
  }
  const items = query.data?.items ?? [];
  return <>
    <PageHeader eyebrow="Live workspace" title="Notifications" description="Stay on top of operational events and workspace announcements." action={(query.data?.unreadCount ?? 0) > 0 ? <button type="button" className="btn btn-primary" onClick={() => markAll.mutate()} disabled={markAll.isPending}><CheckCheck size={17} />Mark all read</button> : undefined} />
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-base-300 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div role="tablist" aria-label="Notification inbox" className="tabs tabs-box bg-base-200 p-1"><button role="tab" aria-selected={tab === "personal"} className={`tab gap-1.5 text-xs font-semibold sm:text-sm ${tab === "personal" ? "tab-active bg-base-100 shadow-sm" : ""}`} onClick={() => setTab("personal")}><Bell size={15} />For you</button><button role="tab" aria-selected={tab === "broadcasts"} className={`tab gap-1.5 text-xs font-semibold sm:text-sm ${tab === "broadcasts" ? "tab-active bg-base-100 shadow-sm" : ""}`} onClick={() => setTab("broadcasts")}><Megaphone size={15} />Announcements</button></div><label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input className="toggle toggle-primary toggle-sm" type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Unread only</label></div>
      {query.isLoading ? <LoadingState label="Loading notifications" /> : query.error ? <div className="p-6"><ErrorState error={query.error} retry={() => void query.refetch()} /></div> : !items.length ? <div className="p-6"><EmptyState icon={tab === "personal" ? <Bell /> : <Megaphone />} title={unreadOnly ? "You’re all caught up" : tab === "personal" ? "No notifications yet" : "No announcements yet"} description={unreadOnly ? "There are no unread items in this inbox." : "New operational messages will appear here automatically."} /></div> : <><div className="divide-y divide-base-300">{items.map((item) => <NotificationRow key={notificationId(item)} item={item} onOpen={() => select(item)} />)}</div><div className="flex items-center justify-between border-t border-base-300 px-4 py-3 sm:px-6"><p className="text-xs text-base-content/45">{query.data?.totalCount ?? items.length} total · {query.data?.unreadCount ?? 0} unread</p><div className="join"><button className="btn btn-sm join-item" disabled={page === 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous notifications"><ChevronLeft size={16} /></button><button className="btn btn-sm join-item" disabled={page * PAGE_SIZE >= (query.data?.totalCount ?? 0)} onClick={() => setPage((current) => current + 1)} aria-label="Next notifications"><ChevronRight size={16} /></button></div></div></>}
      {markAll.error && <div className="border-t border-base-300 p-4"><ErrorState error={markAll.error} /></div>}
    </section>
    <NotificationDetail kind="personal" id={searchParams.get("notification")} onClose={() => select(null)} />
    <NotificationDetail kind="broadcast" id={searchParams.get("broadcast")} onClose={() => select(null)} />
  </>;
}

function NotificationRow({ item, onOpen }: { item: NotificationHistoryItem | NotificationBroadcastItem; onOpen: () => void }) { const unread = !item.readAtUtc; return <button type="button" className={`grid w-full gap-3 p-5 text-left transition hover:bg-base-200/70 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-6 ${unread ? "bg-primary/[0.035]" : ""}`} onClick={onOpen}><SeverityIcon severity={item.severity} /><div className="min-w-0"><div className="flex items-center gap-2"><p className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>{item.title}</p>{unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 line-clamp-2 text-sm text-base-content/55">{item.body || humanize(item.name)}</p><p className="mt-1 text-xs capitalize text-base-content/40">{humanize(item.module)} · {formatRelative(item.occurredAtUtc)}</p></div><StatusBadge status={notificationSeverityLabel(item.severity)} /></button>; }

function NotificationDetail({ kind, id, onClose }: { kind: "personal" | "broadcast"; id: string | null; onClose: () => void }) { const { request } = useSession(); const queryClient = useQueryClient(); const base = kind === "personal" ? "/api/notifications" : "/api/notifications/broadcasts"; const item = useQuery({ queryKey: ["notifications", kind === "personal" ? "history" : "broadcasts", "detail", id], queryFn: () => request<NotificationHistoryItem | NotificationBroadcastItem>(`${base}/${id}`), enabled: Boolean(id) }); const markRead = useMutation({ mutationFn: () => request<NotificationHistoryItem | NotificationBroadcastItem>(`${base}/${id}/read`, { method: "POST" }), onSuccess: async (updated) => { queryClient.setQueryData(["notifications", kind === "personal" ? "history" : "broadcasts", "detail", id], updated); await queryClient.invalidateQueries({ queryKey: ["notifications", kind === "personal" ? "history" : "broadcasts"] }); } }); const data = item.data; return <Modal open={Boolean(id)} title={data?.title || (kind === "personal" ? "Notification" : "Announcement")} description={data ? `${humanize(data.module)} · ${formatDateTime(data.occurredAtUtc)}` : "Loading message"} onClose={onClose}>{item.isLoading ? <LoadingState label="Loading message" /> : item.error ? <ErrorState error={item.error} retry={() => void item.refetch()} /> : data ? <div className="space-y-5"><div className="flex items-center justify-between rounded-2xl bg-base-200 p-4"><div className="flex items-center gap-3"><SeverityIcon severity={data.severity} /><div><p className="font-semibold capitalize">{notificationSeverityLabel(data.severity)}</p><p className="mt-1 text-xs text-base-content/50">{data.readAtUtc ? `Read ${formatDateTime(data.readAtUtc)}` : "Unread"}</p></div></div><StatusBadge status={data.readAtUtc ? "read" : "unread"} /></div>{data.body && <p className="whitespace-pre-wrap text-sm leading-7 text-base-content/70">{data.body}</p>}{"audience" in data && <div className="rounded-xl border border-base-300 p-4"><p className="text-xs text-base-content/40">Audience</p><p className="mt-1 text-sm font-semibold capitalize">{notificationAudienceLabel(data.audience)}</p></div>}{hasPayload(data.payload) && <details className="rounded-xl border border-base-300 p-4"><summary className="cursor-pointer text-sm font-semibold">Technical details</summary><pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral p-3 font-mono text-xs text-neutral-content">{JSON.stringify(data.payload, null, 2)}</pre></details>}{markRead.error && <ErrorState error={markRead.error} />}<div className="flex flex-wrap justify-end gap-2 border-t border-base-300 pt-5">{!data.readAtUtc && <button type="button" className="btn btn-primary" onClick={() => markRead.mutate()} disabled={markRead.isPending}><Check size={16} />Mark as read</button>}<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div></div> : null}</Modal>; }

function SeverityIcon({ severity }: { severity: NotificationSeverity }) { const label = notificationSeverityLabel(severity); const config: Record<string, { icon: ReactNode; tone: string }> = { success: { icon: <ShieldCheck size={18} />, tone: "bg-primary/10 text-primary" }, warning: { icon: <CircleAlert size={18} />, tone: "bg-warning/15 text-warning" }, error: { icon: <AlertCircle size={18} />, tone: "bg-error/10 text-error" }, info: { icon: <Info size={18} />, tone: "bg-info/10 text-info" } }; const selected = config[label] || config.info; return <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected.tone}`}>{selected.icon}</span>; }
function notificationId(item: NotificationHistoryItem | NotificationBroadcastItem) { return "broadcastId" in item ? item.broadcastId : item.id; }
function hasPayload(payload: unknown) { return payload != null && (typeof payload !== "object" || Object.keys(payload as object).length > 0); }
function humanize(value: string) { return value.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()); }
function formatRelative(value: string) { const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return "just now"; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`; return `${Math.floor(seconds / 86_400)}d ago`; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
