import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { BadgeCheck, BriefcaseBusiness, CircleUserRound, ContactRound } from "lucide-react";
import type { StaffMember } from "../../api/types";
import type { CompositeSource } from "../../app/compositeSourceState";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import {
  ErrorState,
  FormActions,
  InlineFormActions,
} from "../../components/ui/primitives";
import type { StaffCreatePayload } from "./staffCreateAttempt";
import { StaffAuthorityNotice } from "./StaffAuthorityNotice";
import { modalIsTopmost } from "../../components/ui/modalFocus";

export function StaffProfileForm({
  member,
  submitting,
  error,
  submitLabel,
  sources,
  authorityCurrent,
  authorityMessage,
  onCancel,
  onSubmit,
}: {
  member?: StaffMember;
  submitting: boolean;
  error: unknown;
  submitLabel: string;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  authorityMessage: string;
  onCancel: () => void;
  onSubmit: (payload: StaffCreatePayload) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const editor = form.current, modal = editor?.closest<HTMLElement>("[data-bunkfy-modal-box]");
    if (!member || !authorityCurrent || submitting || !editor || !modal) return;
    let port = editor.parentElement;
    while (port && port !== modal && !/^(auto|scroll)$/.test(getComputedStyle(port).overflowY)) port = port.parentElement;
    if (!port || port === modal) return;
    const scrollport = port;
    let width = window.innerWidth, height = window.innerHeight;
    let visibleField: HTMLElement | null = null;
    let pointerDown = false;
    const remember = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !editor.contains(active) || !active.matches("input") || active.matches(":disabled, [readonly]")) { visibleField = null; return; }
      const rect = active.getBoundingClientRect(), bounds = scrollport.getBoundingClientRect();
      visibleField = rect.top >= bounds.top && rect.bottom <= bounds.bottom ? active : null;
    };
    const shrink = () => {
      const smaller = window.innerWidth < width || window.innerHeight < height;
      width = window.innerWidth; height = window.innerHeight;
      const target = visibleField;
      if (smaller && !pointerDown && target?.isConnected && editor.isConnected && document.activeElement === target && modalIsTopmost(modal)) {
        const rect = target.getBoundingClientRect(), bounds = scrollport.getBoundingClientRect();
        const top = bounds.top + 8, bottom = bounds.bottom - 8;
        scrollport.scrollTop += rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      }
      remember();
    };
    const startPointer = () => { pointerDown = true; };
    const endPointer = () => { pointerDown = false; remember(); };
    const clear = () => { visibleField = null; };
    remember();
    editor.addEventListener("focusin", remember); editor.addEventListener("focusout", clear);
    scrollport.addEventListener("scroll", remember, { passive: true }); scrollport.addEventListener("pointerdown", startPointer);
    document.addEventListener("pointerup", endPointer); document.addEventListener("pointercancel", endPointer);
    window.addEventListener("resize", shrink);
    return () => {
      editor.removeEventListener("focusin", remember); editor.removeEventListener("focusout", clear);
      scrollport.removeEventListener("scroll", remember); scrollport.removeEventListener("pointerdown", startPointer);
      document.removeEventListener("pointerup", endPointer); document.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("resize", shrink);
    };
  }, [member, authorityCurrent, submitting]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorityCurrent) return;
    const data = new FormData(event.currentTarget);
    onSubmit({
      displayName: String(data.get("displayName") ?? "").trim(),
      legalName: emptyToNull(data.get("legalName")),
      workEmail: emptyToNull(data.get("workEmail")),
      workPhone: emptyToNull(data.get("workPhone")),
      employeeNumber: emptyToNull(data.get("employeeNumber")),
      jobTitle: emptyToNull(data.get("jobTitle")),
      department: emptyToNull(data.get("department")),
    });
  }

  return (
    <form ref={form} className="space-y-4" onSubmit={submit}>
      <CompositeSourceNotice
        className="mb-0"
        sources={sources}
        title="Staff command context is delayed"
      />
      {!authorityCurrent && <StaffAuthorityNotice message={authorityMessage} />}
      <fieldset disabled={!authorityCurrent || submitting} className="space-y-6">
        <FormSection icon={<CircleUserRound size={17} />} title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Display name"
              name="displayName"
              defaultValue={member?.displayName}
              maxLength={256}
            />
            <TextField
              label="Legal name (optional)"
              name="legalName"
              defaultValue={member?.legalName || ""}
              required={false}
              maxLength={256}
            />
          </div>
        </FormSection>

        <FormSection icon={<BriefcaseBusiness size={17} />} title="Employment">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Job title (optional)"
              name="jobTitle"
              defaultValue={member?.jobTitle || ""}
              required={false}
              maxLength={128}
            />
            <TextField
              label="Department (optional)"
              name="department"
              defaultValue={member?.department || ""}
              required={false}
              maxLength={128}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Employee number (optional)"
              name="employeeNumber"
              defaultValue={member?.employeeNumber || ""}
              required={false}
              maxLength={64}
              icon={<BadgeCheck size={15} />}
            />
          </div>
        </FormSection>

        <FormSection icon={<ContactRound size={17} />} title="Work contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Work email (optional)"
              name="workEmail"
              type="email"
              defaultValue={member?.workEmail || ""}
              required={false}
              maxLength={320}
            />
            <TextField
              label="Work phone (optional)"
              name="workPhone"
              type="tel"
              defaultValue={member?.workPhone || ""}
              required={false}
              maxLength={64}
            />
          </div>
        </FormSection>
      </fieldset>
      {Boolean(error) && <ErrorState error={error} />}
      {member ? (
        <InlineFormActions>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submitting || !authorityCurrent}
          >
            {submitting && <span className="loading loading-spinner loading-xs" />}
            {submitLabel}
          </button>
        </InlineFormActions>
      ) : (
        <FormActions
          submitting={submitting}
          disabled={!authorityCurrent}
          submitLabel={submitLabel}
          onCancel={onCancel}
        />
      )}
    </form>
  );
}

function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  required = true,
  maxLength,
  icon,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  icon?: ReactNode;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 flex items-center gap-1.5 text-sm font-semibold">{icon && <span className="text-primary">{icon}</span>}{label}</span>
      <input
        className="input input-bordered w-full"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function FormSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-base-300 pt-5 first:border-t-0 first:pt-0">
      <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
        <span className="text-primary">{icon}</span>{title}
      </h3>
      {children}
    </section>
  );
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
