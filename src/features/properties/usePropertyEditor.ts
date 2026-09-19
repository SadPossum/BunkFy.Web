import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Property, PropertyMutationReceipt, PropertyTimeZoneMutationReceipt } from "../../api/types";
import { ApiError } from "../../api/client";
import { useSession } from "../../app/session";
import { sessionIdentityKey } from "../../app/singleFlightRefresh";
import { useWorkspace } from "../../app/workspace";
import { propertyRecordMatches } from "./propertiesMutationAuthority";
import { resolvePropertyCreateAttempt, type PropertyCreateAttempt } from "./propertyCreateAttempt";
import { resolvePropertyUpdateAttempt, type PropertyUpdateAttempt } from "./propertyUpdateAttempt";
import { resolvePropertyTimeZoneAttempt, type PropertyTimeZoneAttempt } from "./propertyTimeZoneAttempt";
import { usePropertyTimeZoneCatalog } from "./propertyTimeZoneCatalog";

export type PropertyFormState = { property?: Property } | null;
export type PropertyMutationInput = { property?: Property; name: string; code: string; timeZoneId: string };
type TimeZoneInput = { property: Property; timeZoneId: string; confirmed: boolean };
type ScopedInput<T> = T & { editorContext: string; editorSession: number };

export function usePropertyEditor({
  property,
  canCreate = false,
  canUpdate,
  canUpdateTimeZone,
  permissionsCurrent,
  mayUpdate,
  mayUpdateTimeZone,
}: {
  property: Property | null;
  canCreate?: boolean;
  canUpdate: boolean;
  canUpdateTimeZone: boolean;
  permissionsCurrent: boolean;
  mayUpdate: boolean;
  mayUpdateTimeZone: boolean;
}) {
  const { request, session } = useSession();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const contextKey = `${sessionIdentityKey(session)}:${property?.propertyId ?? ""}`;
  const currentContext = useRef(contextKey);
  const editorSession = useRef(0);
  currentContext.current = contextKey;
  const [propertyForm, setPropertyForm] = useState<PropertyFormState>(null);
  const [timeZoneTarget, setTimeZoneTarget] = useState<Property | null>(null);
  const [notice, setNotice] = useState("");
  const propertyOpener = useRef<HTMLElement | null>(null);
  const timeZoneOpener = useRef<HTMLElement | null>(null);
  const createAttempt = useRef<PropertyCreateAttempt | null>(null);
  const updateAttempt = useRef<PropertyUpdateAttempt | null>(null);
  const timeZoneAttempt = useRef<PropertyTimeZoneAttempt | null>(null);
  const catalog = usePropertyTimeZoneCatalog(
    timeZoneTarget?.propertyId ?? null,
    Boolean(timeZoneTarget || (propertyForm && !propertyForm.property)),
  );

  async function invalidateProperty(propertyId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["beds", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["property-processing", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-rooms", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
    ]);
    await workspace.refetchProperties();
  }

  const propertyMutation = useMutation({
    mutationFn: async (input: ScopedInput<PropertyMutationInput>) => {
      requireCurrent(attemptCurrent(input) && (input.property
        ? canUpdate && propertyIdentityRecordEditable(property, input.property)
        : canCreate && catalog.current && catalog.isSelectable(input.timeZoneId)),
      "Refresh property access and directory data before saving this property.");
      if (input.property) {
        updateAttempt.current = resolvePropertyUpdateAttempt(updateAttempt.current, {
          propertyId: input.property.propertyId,
          expectedVersion: input.property.version,
          name: input.name,
          code: input.code,
        });
        return request<PropertyMutationReceipt>(`/api/properties/${input.property.propertyId}`, {
          method: "PUT",
          body: JSON.stringify({
            operationId: updateAttempt.current.operationId,
            name: input.name,
            code: input.code,
            timeZoneId: null,
            expectedVersion: input.property.version,
          }),
        });
      }
      createAttempt.current = resolvePropertyCreateAttempt(createAttempt.current, input);
      return request<PropertyMutationReceipt>("/api/properties/", {
        method: "POST",
        body: JSON.stringify({
          operationId: createAttempt.current.operationId,
          name: input.name,
          code: input.code,
          timeZoneId: input.timeZoneId,
        }),
      });
    },
    onSuccess: async (receipt, input) => {
      await invalidateProperty(receipt.propertyId);
      if (!attemptCurrent(input)) return;
      createAttempt.current = null;
      updateAttempt.current = null;
      setPropertyForm(null);
      setNotice(input.property ? "Property details saved." : "Property created.");
      if (!input.property) workspace.setSelectedPropertyId(receipt.propertyId);
    },
  });
  const timeZoneMutation = useMutation({
    mutationFn: (input: ScopedInput<TimeZoneInput>) => {
      requireCurrent(attemptCurrent(input) && canUpdateTimeZone
        && propertyRecordMatches(property, input.property) && catalog.current
        && catalog.isSelectable(input.timeZoneId),
      "Refresh property access and directory data before changing this time zone.");
      timeZoneAttempt.current = resolvePropertyTimeZoneAttempt(timeZoneAttempt.current, {
        propertyId: input.property.propertyId,
        expectedVersion: input.property.version,
        timeZoneId: input.timeZoneId,
      });
      return request<PropertyTimeZoneMutationReceipt>(`/api/properties/${input.property.propertyId}/time-zone`, {
        method: "PUT",
        body: JSON.stringify({
          operationId: timeZoneAttempt.current.operationId,
          timeZoneId: input.timeZoneId,
          confirmed: input.confirmed,
          expectedVersion: input.property.version,
        }),
      });
    },
    onSuccess: async (_receipt, input) => {
      await invalidateProperty(input.property.propertyId);
      if (!attemptCurrent(input)) return;
      timeZoneAttempt.current = null;
      setTimeZoneTarget(null);
      setNotice("Property time zone saved.");
    },
  });

  function attemptCurrent(input: ScopedInput<unknown>) {
    return propertyEditorAttemptCurrent(input, { editorContext: currentContext.current, editorSession: editorSession.current });
  }
  function resetPropertyForm() {
    editorSession.current += 1;
    createAttempt.current = null;
    updateAttempt.current = null;
    propertyMutation.reset();
    setPropertyForm(null);
  }
  function resetTimeZoneForm() {
    editorSession.current += 1;
    timeZoneAttempt.current = null;
    timeZoneMutation.reset();
    setTimeZoneTarget(null);
  }
  useEffect(() => {
    resetPropertyForm();
    resetTimeZoneForm();
    setNotice("");
    // A new property or actor must never inherit another editor's pending attempt.
  }, [contextKey]);
  useEffect(() => {
    if (!permissionsCurrent) return;
    if (!mayUpdate && propertyForm?.property) resetPropertyForm();
    if (!mayUpdateTimeZone && timeZoneTarget) resetTimeZoneForm();
    // Keep drafts during refresh; discard them only after confirmed permission loss.
  }, [permissionsCurrent, mayUpdate, mayUpdateTimeZone]);

  const propertyFormRetired = Boolean(propertyForm?.property && (
    propertyForm.property.status === "retired"
    || (property?.propertyId === propertyForm.property.propertyId && property.status === "retired")
    || (propertyMutation.error instanceof ApiError && propertyMutation.error.code === "Properties.PropertyRetired")
  ));

  return {
    propertyForm,
    propertyFormRetired,
    timeZoneTarget,
    propertyOpener,
    timeZoneOpener,
    catalog,
    notice,
    busy: propertyMutation.isPending || timeZoneMutation.isPending,
    propertyMutation,
    timeZoneMutation,
    propertyConflict: isPropertyVersionConflict(propertyMutation.error),
    timeZoneConflict: isPropertyVersionConflict(timeZoneMutation.error),
    propertyFormCanSubmit: !propertyFormRetired && !isPropertyVersionConflict(propertyMutation.error) && (propertyForm?.property
      ? canUpdate && propertyIdentityRecordEditable(property, propertyForm.property)
      : canCreate),
    timeZoneCanSubmit: Boolean(timeZoneTarget && canUpdateTimeZone
      && propertyRecordMatches(property, timeZoneTarget) && catalog.current
      && !isPropertyVersionConflict(timeZoneMutation.error)),
    openPropertyForm: (state: NonNullable<PropertyFormState>, opener?: HTMLElement) => {
      if (propertyMutation.isPending || timeZoneMutation.isPending) return;
      if (state.property && (!canUpdate || !propertyIdentityRecordEditable(property, state.property))) return;
      propertyOpener.current = opener ?? null;
      resetTimeZoneForm();
      propertyMutation.reset();
      setNotice("");
      setPropertyForm(state);
    },
    openTimeZoneForm: (target: Property, opener?: HTMLElement) => {
      if (propertyMutation.isPending || timeZoneMutation.isPending) return;
      timeZoneOpener.current = opener ?? null;
      resetPropertyForm();
      timeZoneMutation.reset();
      setNotice("");
      setTimeZoneTarget(target);
    },
    closePropertyForm: () => { if (!propertyMutation.isPending) resetPropertyForm(); },
    closeTimeZoneForm: () => { if (!timeZoneMutation.isPending) resetTimeZoneForm(); },
    saveProperty: (input: PropertyMutationInput) => {
      if (propertyFormRetired || (input.property && (!canUpdate || !propertyIdentityRecordEditable(property, input.property)))) return;
      if (!isPropertyVersionConflict(propertyMutation.error)) propertyMutation.mutate({ ...input, editorContext: contextKey, editorSession: editorSession.current });
    },
    saveTimeZone: (timeZoneId: string, confirmed: boolean) => {
      if (timeZoneTarget && !isPropertyVersionConflict(timeZoneMutation.error)) timeZoneMutation.mutate({ property: timeZoneTarget, timeZoneId, confirmed, editorContext: contextKey, editorSession: editorSession.current });
    },
    retryProperty: () => {
      if (!propertyFormRetired && propertyMutation.variables && !isPropertyVersionConflict(propertyMutation.error)) propertyMutation.mutate(propertyMutation.variables);
    },
    retryTimeZone: () => {
      if (timeZoneMutation.variables && !isPropertyVersionConflict(timeZoneMutation.error)) timeZoneMutation.mutate(timeZoneMutation.variables);
    },
    refreshProperty: () => property ? invalidateProperty(property.propertyId) : workspace.refetchProperties(),
    refreshTimeZone: () => Promise.all([
      property ? invalidateProperty(property.propertyId) : workspace.refetchProperties(),
      catalog.source.refetch(),
    ]),
  };
}

export function isPropertyVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "Properties.VersionConflict";
}

export function propertyIdentityRecordEditable(current: Property | null, candidate: Property): boolean {
  return current?.status === "active" && candidate.status === "active" && propertyRecordMatches(current, candidate);
}

export function propertyEditorAttemptCurrent(
  attempt: { editorContext: string; editorSession: number },
  current: { editorContext: string; editorSession: number },
): boolean {
  return attempt.editorContext === current.editorContext && attempt.editorSession === current.editorSession;
}

function requireCurrent(allowed: boolean, message: string) {
  if (!allowed) throw new Error(message);
}
