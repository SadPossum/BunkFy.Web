import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../api/client";
import type { OrganizationEnrollmentPreview, OrganizationInvitationPreview } from "../../api/types";
import { LoadingState } from "../../components/ui/primitives";
import { AuthPage } from "../auth/AuthPage";
import { readPreservedWorkspaceJoinContext, workspaceJoinContextHeaders, workspaceJoinContextPath } from "./workspaceJoin";
import { workspaceJoinAllowsNewApplication, workspaceJoinUnavailableNotice } from "./workspaceJoinAvailability";

export function WorkspaceJoinAuthenticationPage() {
  const [context] = useState(readPreservedWorkspaceJoinContext);
  const preview = useQuery<OrganizationInvitationPreview | OrganizationEnrollmentPreview>({
    queryKey: ["workspace-join-preview", context?.kind, context?.contextId],
    queryFn: () => apiRequest(workspaceJoinContextPath(context!) + "/preview", {
      method: "POST", headers: workspaceJoinContextHeaders(context!),
    }),
    enabled: Boolean(context),
    retry: false,
  });
  if (context && preview.isLoading && !preview.data) return <main className="grid min-h-screen place-items-center bg-base-200 p-6">
    <LoadingState label="Checking the invitation" />
  </main>;

  const unavailable = !context ? {
    title: "Invitation link incomplete",
    description: "Open the complete invitation link or scan the QR code provided by your workspace owner.",
  } : preview.error || !preview.data ? {
    title: "Invitation unavailable",
    description: "BunkFy could not check this invitation. Try again, or ask the workspace owner for a new link.",
  } : workspaceJoinUnavailableNotice(context, preview.data);

  return <AuthPage invitation invitationUnavailable={unavailable}
    onRefreshInvitation={context ? () => void preview.refetch() : undefined}
    refreshingInvitation={preview.isFetching}
    confirmInvitation={async () => {
      if (!context) return false;
      const latest = await preview.refetch();
      return !latest.error && Boolean(latest.data && workspaceJoinAllowsNewApplication(context, latest.data));
    }} />;
}
