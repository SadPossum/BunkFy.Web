import type { OrganizationEnrollmentPreview, OrganizationInvitationPreview } from "../../api/types";
import type { WorkspaceJoinContext } from "./workspaceJoin";

type JoinPreview = OrganizationEnrollmentPreview | OrganizationInvitationPreview;
export type WorkspaceJoinNotice = { title: string; description: string };

export function workspaceJoinAllowsNewApplication(context: WorkspaceJoinContext, preview: JoinPreview): boolean {
  return preview.status === (context.kind === "invitation" ? "pending" : "active");
}

export function workspaceJoinAllowsInvitationReplay(context: WorkspaceJoinContext, preview: JoinPreview): boolean {
  return context.kind === "invitation" && preview.status === "accepted";
}

export function workspaceJoinUnavailableNotice(context: WorkspaceJoinContext, preview: JoinPreview): WorkspaceJoinNotice | null {
  if (workspaceJoinAllowsNewApplication(context, preview)) return null;
  if (context.kind === "invitation") {
    switch (preview.status) {
      case "accepted": return {
        title: "Invitation already accepted",
        description: "This single-use invitation has already been used. Sign in with the account that accepted it to check your workspace access.",
      };
      case "revoked": return { title: "Invitation revoked", description: "The workspace owner revoked this invitation. Ask them for a new invitation if you still need to join." };
      case "superseded": return { title: "Invitation replaced", description: "The workspace owner replaced this invitation. Open the latest link they provided." };
      case "expired": return { title: "Invitation expired", description: "This invitation has expired. Ask the workspace owner for a new invitation if you still need to join." };
    }
  } else {
    switch (preview.status) {
      case "disabled": return { title: "Team link disabled", description: "The workspace owner disabled this team link. It no longer accepts new access requests." };
      case "rotated": return { title: "Team link replaced", description: "The workspace owner replaced this team link. Open the latest link to request access." };
      case "expired": return { title: "Team link expired", description: "This team link has expired. Ask the workspace owner for a new link to request access." };
      case "capacity-reached": return { title: "Team link is full", description: "This team link has reached its limit for access requests. Ask the workspace owner for another link." };
    }
  }
  return { title: "Invitation status unavailable", description: "BunkFy could not confirm whether this link accepts new requests. Refresh the invitation or ask the workspace owner for a new link." };
}
