import { ApiError } from "../../api/client";
import type { StaffMember } from "../../api/types";

const INVITE_STAFF_DRAFT_KEY = "bunkfy.invite.staff-profile.v2";
const LEGACY_INVITE_STAFF_DRAFT_KEY = "bunkfy.invite.staff-profile.v1";

export type StaffProfileDraft = {
  displayName: string;
  legalName: string;
  workEmail: string;
  workPhone: string;
  jobTitle: string;
  department: string;
};

export function defaultStaffProfile(email = ""): StaffProfileDraft {
  const localPart = email.split("@")[0] ?? "";
  const suggestedName = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    displayName: suggestedName,
    legalName: "",
    workEmail: email,
    workPhone: "",
    jobTitle: "",
    department: "",
  };
}

export function saveInviteStaffDraft(
  profile: StaffProfileDraft,
  identity = "",
): void {
  window.sessionStorage.setItem(staffDraftKey(identity), JSON.stringify(profile));
}

export function readInviteStaffDraft(email = ""): StaffProfileDraft {
  const fallback = defaultStaffProfile(email);
  try {
    const stored = window.sessionStorage.getItem(staffDraftKey(email));
    const legacy = stored ? null : readCompatibleLegacyDraft(email);
    const parsed = JSON.parse(stored ?? legacy ?? "null") as Partial<StaffProfileDraft> | null;
    return parsed ? { ...fallback, ...parsed, workEmail: parsed.workEmail || fallback.workEmail } : fallback;
  } catch {
    return fallback;
  }
}

export function clearInviteStaffDraft(identity = ""): void {
  window.sessionStorage.removeItem(staffDraftKey(identity));
}

export async function completeCurrentStaffProfile(
  request: <T>(path: string, options?: RequestInit) => Promise<T>,
  profile: StaffProfileDraft,
): Promise<StaffMember> {
  const current = await waitForCurrentStaffProfile(request);
  return request<StaffMember>("/api/staff/me", {
    method: "PUT",
    body: JSON.stringify({
      displayName: profile.displayName.trim(),
      legalName: emptyToNull(profile.legalName),
      workEmail: emptyToNull(profile.workEmail),
      workPhone: emptyToNull(profile.workPhone),
      employeeNumber: current.employeeNumber ?? null,
      jobTitle: emptyToNull(profile.jobTitle),
      department: emptyToNull(profile.department),
      expectedVersion: current.version,
    }),
  });
}

async function waitForCurrentStaffProfile(
  request: <T>(path: string, options?: RequestInit) => Promise<T>,
): Promise<StaffMember> {
  const deadline = Date.now() + 12_000;
  while (true) {
    try {
      return await request<StaffMember>("/api/staff/me");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404 || Date.now() >= deadline) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }
}

function emptyToNull(value: string): string | null {
  return value.trim() || null;
}

function staffDraftKey(identity: string): string {
  const account = identity.trim().toLowerCase() || "anonymous";
  return `${INVITE_STAFF_DRAFT_KEY}:${encodeURIComponent(account)}`;
}

function readCompatibleLegacyDraft(identity: string): string | null {
  const legacy = window.sessionStorage.getItem(LEGACY_INVITE_STAFF_DRAFT_KEY);
  if (!legacy || !identity.trim()) return null;

  try {
    const parsed = JSON.parse(legacy) as Partial<StaffProfileDraft>;
    if (parsed.workEmail?.trim().toLowerCase() !== identity.trim().toLowerCase()) {
      return null;
    }

    window.sessionStorage.removeItem(LEGACY_INVITE_STAFF_DRAFT_KEY);
    window.sessionStorage.setItem(staffDraftKey(identity), legacy);
    return legacy;
  } catch {
    return null;
  }
}
