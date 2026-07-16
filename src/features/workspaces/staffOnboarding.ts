import { ApiError } from "../../api/client";
import type { StaffMember } from "../../api/types";

const INVITE_STAFF_DRAFT_KEY = "bunkfy.invite.staff-profile.v1";

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

export function saveInviteStaffDraft(profile: StaffProfileDraft): void {
  window.sessionStorage.setItem(INVITE_STAFF_DRAFT_KEY, JSON.stringify(profile));
}

export function readInviteStaffDraft(email = ""): StaffProfileDraft {
  const fallback = defaultStaffProfile(email);
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(INVITE_STAFF_DRAFT_KEY) ?? "null") as Partial<StaffProfileDraft> | null;
    return parsed ? { ...fallback, ...parsed, workEmail: parsed.workEmail || fallback.workEmail } : fallback;
  } catch {
    return fallback;
  }
}

export function clearInviteStaffDraft(): void {
  window.sessionStorage.removeItem(INVITE_STAFF_DRAFT_KEY);
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
