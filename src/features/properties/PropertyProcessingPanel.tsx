import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Globe2, Pause, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  CountryPolicy,
  CountryPolicyListResponse,
  Property,
  PropertyGovernancePolicyBinding,
  PropertyMutationReceipt,
  PropertyProcessingState,
} from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  ErrorState,
  FormActions,
  Modal,
  ModalActions,
  StatusBadge,
} from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  availableCountryPolicies,
  buildPropertyProcessingActivation,
  choosePolicyCoordinate,
  chooseRetentionPolicy,
  countryPolicyKey,
  matchingBoundPolicy,
  propertyProcessingMessage,
  type PropertyProcessingActivationInput,
} from "./propertyProcessing";
import { propertiesMutationAllowed } from "./propertiesMutationAuthority";
import {
  resolvePropertyActivationAttempt,
  resolvePropertySimpleLifecycleAttempt,
  type PropertyLifecycleAttempt,
} from "./propertyLifecycleAttempt";

type PropertyProcessingPanelProps = {
  property: Property;
  canManage: boolean;
  permissionsCurrent: boolean;
  propertyCurrent: boolean;
  onChanged: () => Promise<void> | void;
};

export function PropertyProcessingPanel({
  property,
  canManage,
  permissionsCurrent,
  propertyCurrent,
  onChanged,
}: PropertyProcessingPanelProps) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [activationOpen, setActivationOpen] = useState(false);
  const [suspensionOpen, setSuspensionOpen] = useState(false);
  const activationAttempt = useRef<PropertyLifecycleAttempt | null>(null);
  const suspensionAttempt = useRef<PropertyLifecycleAttempt | null>(null);
  const processing = useQuery({
    queryKey: ["property-processing", property.propertyId],
    queryFn: () => request<PropertyProcessingState>(`/api/properties/${property.propertyId}/processing`),
  });
  const policies = useQuery({
    queryKey: ["country-policies", property.propertyId],
    queryFn: () => request<CountryPolicyListResponse>(`/api/properties/${property.propertyId}/country-policies`),
    enabled: canManage,
    staleTime: 60_000,
  });
  const processingSource = createCompositeSource({
    label: "Processing status",
    hasData: processing.data !== undefined,
    isLoading: processing.isLoading,
    error: processing.error,
    isFetching: processing.isFetching,
    refetch: () => processing.refetch(),
  });
  const policySource = createCompositeSource({
    label: "Country policies",
    hasData: policies.data !== undefined,
    isLoading: policies.isLoading,
    error: policies.error,
    isFetching: policies.isFetching,
    refetch: () => policies.refetch(),
  });
  const processingUsable = compositeSourceUsable(processingSource.state);
  const policiesUsable = compositeSourceUsable(policySource.state);
  const state = processingUsable ? processing.data : undefined;
  const binding = state?.governancePolicy ?? null;
  const selectablePolicies = policiesUsable
    ? availableCountryPolicies(policies.data?.items ?? [])
    : [];
  const canActivate = canManage && propertiesMutationAllowed("activate-processing", {
    permissionsCurrent,
    propertyCurrent,
    processingCurrent: compositeSourceCurrent(processingSource),
    policiesCurrent: compositeSourceCurrent(policySource),
  });
  const canSuspend = canManage && state?.configuredStatus === "enabled" &&
    propertiesMutationAllowed("suspend-processing", {
      permissionsCurrent,
      propertyCurrent,
      processingCurrent: compositeSourceCurrent(processingSource),
    });
  const governanceSources = [
    processingSource,
    ...(canManage ? [policySource] : []),
  ];

  useEffect(() => {
    activationAttempt.current = null;
    suspensionAttempt.current = null;
    setActivationOpen(false);
    setSuspensionOpen(false);
  }, [property.propertyId]);

  useEffect(() => {
    if (!permissionsCurrent || canManage) return;
    activationAttempt.current = null;
    suspensionAttempt.current = null;
    setActivationOpen(false);
    setSuspensionOpen(false);
  }, [canManage, permissionsCurrent]);

  async function refreshProperty() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["property-processing", property.propertyId] }),
      onChanged(),
    ]);
  }

  const activation = useMutation({
    mutationFn: (input: PropertyProcessingActivationInput) => {
      requireProcessingAuthority(
        canActivate,
        "Refresh property access, processing status, and country policies before configuring data processing.",
      );
      activationAttempt.current = resolvePropertyActivationAttempt(
        activationAttempt.current,
        property.propertyId,
        input,
      );
      return request<PropertyMutationReceipt>(
        `/api/properties/${property.propertyId}/processing/activate`,
        {
          method: "POST",
          body: JSON.stringify({
            ...input,
            operationId: activationAttempt.current.operationId,
          }),
        },
      );
    },
    onSuccess: async () => {
      activationAttempt.current = null;
      setActivationOpen(false);
      await refreshProperty();
    },
  });
  const suspension = useMutation({
    mutationFn: (expectedVersion: number) => {
      requireProcessingAuthority(
        canSuspend,
        "Refresh property access and processing status before suspending data processing.",
      );
      suspensionAttempt.current = resolvePropertySimpleLifecycleAttempt(
        suspensionAttempt.current,
        "processing-suspension",
        property.propertyId,
        expectedVersion,
      );
      return request<PropertyMutationReceipt>(
        `/api/properties/${property.propertyId}/processing/suspend`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: suspensionAttempt.current.operationId,
            confirmed: true,
            expectedVersion,
          }),
        },
      );
    },
    onSuccess: async () => {
      suspensionAttempt.current = null;
      setSuspensionOpen(false);
      await refreshProperty();
    },
  });
  const activationNeedsAuthentication =
    isInsufficientAuthenticationError(activation.error);

  function retryActivationAfterAuthentication() {
    const input = activation.variables;
    if (!input) return;
    activation.reset();
    activation.mutate(input);
  }

  if (!processingUsable || !state) {
    return (
      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <CompositeSourceNotice
          className="mx-5 mt-5 sm:mx-6"
          sources={governanceSources}
          title="Data-processing context is delayed"
        />
        <CompositeSourceFallback state={processingSource.state} label="data processing" />
      </section>
    );
  }

  const needsAttention = state.effectiveStatus === "expired" || state.effectiveStatus === "revoked";

  return (
    <>
      <section className={`card border bg-base-100 shadow-sm ${needsAttention ? "border-warning/45" : "border-base-300"}`}>
        <div className="card-body gap-5 p-5 sm:p-6">
          <CompositeSourceNotice
            className=""
            sources={governanceSources}
            title="Data-processing context is delayed"
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${needsAttention ? "bg-warning/15 text-warning-content" : state.effectiveStatus === "enabled" ? "bg-success/15 text-success" : "bg-base-200 text-base-content/55"}`}>
                {needsAttention ? <ShieldAlert size={19} /> : state.effectiveStatus === "enabled" ? <ShieldCheck size={19} /> : <Globe2 size={19} />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold">Data processing</h2>
                  <StatusBadge status={state.effectiveStatus} />
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-base-content/60">
                  {propertyProcessingMessage(state.effectiveStatus)}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {canSuspend && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setSuspensionOpen(true)}>
                    <Pause size={15} />Suspend
                  </button>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!canActivate || selectablePolicies.length === 0}
                  onClick={() => setActivationOpen(true)}
                >
                  <RotateCcw size={15} />
                  {binding ? "Change policy" : "Configure"}
                </button>
              </div>
            )}
          </div>

          {binding && <PolicyBindingDetails binding={binding} />}

          {canManage && compositeSourceCurrent(policySource) && selectablePolicies.length === 0 && (
            <div className="alert border border-base-300 bg-base-200/65 text-base-content">
              <Database size={18} className="text-base-content/50" />
              <div>
                <p className="font-semibold">No usable country policy is configured</p>
                <p className="text-sm text-base-content/60">This property remains blocked until the deployment administrator installs and allowlists a current policy pack.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <PolicyActivationModal
        open={activationOpen}
        property={property}
        processing={state}
        policies={selectablePolicies}
        authorityCurrent={canActivate}
        pending={activation.isPending}
        error={activationNeedsAuthentication && canActivate ? null : activation.error}
        authenticationPrompt={activationNeedsAuthentication && canActivate ? (
          <RecentAuthenticationPrompt
            error={activation.error}
            title="Confirm your password to enable data processing"
            description={`This will enable or change the policy governing guest, reservation and adapter data for ${property.name}.`}
            onAuthenticated={retryActivationAfterAuthentication}
          />
        ) : null}
        onClose={() => {
          activationAttempt.current = null;
          activation.reset();
          setActivationOpen(false);
        }}
        onSubmit={(input) => canActivate && activation.mutate(input)}
      />
      <SuspendProcessingModal
        open={suspensionOpen}
        state={state}
        authorityCurrent={canSuspend}
        pending={suspension.isPending}
        error={suspension.error}
        onClose={() => {
          suspensionAttempt.current = null;
          suspension.reset();
          setSuspensionOpen(false);
        }}
        onConfirm={() => canSuspend && suspension.mutate(state.propertyVersion)}
      />
    </>
  );
}

function PolicyBindingDetails({ binding }: { binding: PropertyGovernancePolicyBinding }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 border-t border-base-300 pt-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <PolicyCoordinate label="Operating country" value={countryLabel(binding.operatingCountryCode)} />
      <PolicyCoordinate label="Policy" value={`${binding.policyId} v${binding.policyVersion}`} />
      <PolicyCoordinate label="Data region" value={binding.dataRegionId} />
      <PolicyCoordinate label="Transfer profile" value={binding.transferProfileId} />
      <PolicyCoordinate label="Retention policy" value={`${binding.retentionPolicyId} v${binding.retentionPolicyVersion}`} />
      <PolicyCoordinate label="Activated" value={formatDate(binding.activatedAtUtc)} />
      <PolicyCoordinate label="Effective" value={formatDate(binding.policyEffectiveAtUtc)} />
      <PolicyCoordinate label="Expires" value={formatDate(binding.policyExpiresAtUtc)} />
    </dl>
  );
}

function PolicyCoordinate({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/40">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function PolicyActivationModal({ open, property, processing, policies, authorityCurrent, pending, error, authenticationPrompt, onClose, onSubmit }: {
  open: boolean;
  property: Property;
  processing: PropertyProcessingState;
  policies: CountryPolicy[];
  authorityCurrent: boolean;
  pending: boolean;
  error: unknown;
  authenticationPrompt: ReactNode;
  onClose: () => void;
  onSubmit: (input: PropertyProcessingActivationInput) => void;
}) {
  const boundPolicy = matchingBoundPolicy(policies, processing.governancePolicy);
  const initialPolicy = boundPolicy ?? policies[0];
  const [policyKey, setPolicyKey] = useState(initialPolicy ? countryPolicyKey(initialPolicy) : "");
  const [dataRegionId, setDataRegionId] = useState("");
  const [transferProfileId, setTransferProfileId] = useState("");
  const [retentionKey, setRetentionKey] = useState("");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const selectedPolicy = policies.find((policy) => countryPolicyKey(policy) === policyKey) ?? initialPolicy;
  const selectedRetention = selectedPolicy?.retentionPolicies.find((policy) => retentionKey === retentionPolicyKey(policy))
    ?? chooseRetentionPolicy(selectedPolicy?.retentionPolicies ?? [], processing.governancePolicy);

  useEffect(() => {
    if (!open || !initialPolicy) return;
    const sameBinding = processing.governancePolicy && countryPolicyKey(initialPolicy) === countryPolicyKey({
      policyId: processing.governancePolicy.policyId,
      policyVersion: processing.governancePolicy.policyVersion,
      contentSha256: processing.governancePolicy.contentSha256,
    });
    setPolicyKey(countryPolicyKey(initialPolicy));
    setDataRegionId(choosePolicyCoordinate(
      initialPolicy.permittedDataRegions,
      sameBinding ? processing.governancePolicy?.dataRegionId : null,
    ));
    setTransferProfileId(choosePolicyCoordinate(
      initialPolicy.permittedTransferProfiles,
      sameBinding ? processing.governancePolicy?.transferProfileId : null,
    ));
    const retention = chooseRetentionPolicy(
      initialPolicy.retentionPolicies,
      sameBinding ? processing.governancePolicy : null,
    );
    setRetentionKey(retention ? retentionPolicyKey(retention) : "");
    setAccepted(new Set());
    setConfirmed(false);
  }, [initialPolicy, open, processing.governancePolicy]);

  function changePolicy(nextKey: string) {
    const nextPolicy = policies.find((policy) => countryPolicyKey(policy) === nextKey);
    if (!nextPolicy) return;
    setPolicyKey(nextKey);
    setDataRegionId(nextPolicy.permittedDataRegions[0] ?? "");
    setTransferProfileId(nextPolicy.permittedTransferProfiles[0] ?? "");
    setRetentionKey(nextPolicy.retentionPolicies[0] ? retentionPolicyKey(nextPolicy.retentionPolicies[0]) : "");
    setAccepted(new Set());
    setConfirmed(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorityCurrent || !selectedPolicy || !selectedRetention || !confirmed || accepted.size !== selectedPolicy.requiredAcknowledgements.length) return;
    onSubmit(buildPropertyProcessingActivation(
      selectedPolicy,
      dataRegionId,
      transferProfileId,
      selectedRetention,
      processing.propertyVersion,
    ));
  }

  const acknowledgementsComplete = Boolean(selectedPolicy) && accepted.size === selectedPolicy.requiredAcknowledgements.length;
  const canSubmit = authorityCurrent && Boolean(selectedPolicy && selectedRetention && dataRegionId && transferProfileId && confirmed && acknowledgementsComplete);

  return (
    <Modal open={open} title={processing.governancePolicy ? "Change country policy" : "Configure data processing"} description={`Choose the deployment policy coordinates for ${property.name}.`} onClose={onClose} size="lg">
      {!selectedPolicy ? (
        <div className="space-y-4 py-4">
          {!authorityCurrent && <ProcessingAuthorityNotice />}
          <div className="alert border border-base-300 bg-base-200/65 text-base-content">
            <Database size={18} className="text-base-content/50" />
            <p className="text-sm">No current country policy is available for this property.</p>
          </div>
        </div>
      ) : authenticationPrompt ? (
        <div className="space-y-4">
          {!authorityCurrent && <ProcessingAuthorityNotice />}
          {authenticationPrompt}
          <ModalActions>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </ModalActions>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {!authorityCurrent && <ProcessingAuthorityNotice />}
          <PickerField label="Country policy">
            <SelectPicker
              className="w-full"
              value={countryPolicyKey(selectedPolicy)}
              onValueChange={changePolicy}
              ariaLabel="Country policy"
              options={policies.map((policy) => ({
                value: countryPolicyKey(policy),
                label: `${countryLabel(policy.operatingCountryCode)} · ${policy.policyId} v${policy.policyVersion}`,
                description: `${policy.supportsRightsResponseDeadlines
                  ? "Guest rights deadlines included"
                  : "Legacy policy - guest rights deadlines unavailable"} · Effective ${formatDate(policy.effectiveAtUtc)} to ${formatDate(policy.expiresAtUtc)}`,
              }))}
            />
          </PickerField>

          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField label="Data region">
              <SelectPicker className="w-full" value={dataRegionId} onValueChange={setDataRegionId} ariaLabel="Data region" options={selectedPolicy.permittedDataRegions.map((value) => ({ value, label: value }))} />
            </PickerField>
            <PickerField label="Transfer profile">
              <SelectPicker className="w-full" value={transferProfileId} onValueChange={setTransferProfileId} ariaLabel="Transfer profile" options={selectedPolicy.permittedTransferProfiles.map((value) => ({ value, label: value }))} />
            </PickerField>
          </div>

          <PickerField label="Retention policy">
            <SelectPicker className="w-full" value={selectedRetention ? retentionPolicyKey(selectedRetention) : ""} onValueChange={setRetentionKey} ariaLabel="Retention policy" options={selectedPolicy.retentionPolicies.map((policy) => ({ value: retentionPolicyKey(policy), label: `${policy.retentionPolicyId} v${policy.retentionPolicyVersion}` }))} />
          </PickerField>

          {selectedPolicy.requiredAcknowledgements.length > 0 && (
            <fieldset className="space-y-2 border-t border-base-300 pt-4">
              <legend className="mb-2 text-sm font-semibold">Required acknowledgements</legend>
              {selectedPolicy.requiredAcknowledgements.map((acknowledgement) => {
                const key = acknowledgementKey(acknowledgement.acknowledgementId, acknowledgement.acknowledgementVersion);
                return (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 p-3 hover:border-primary/35">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary checkbox-sm mt-0.5"
                      checked={accepted.has(key)}
                      onChange={(event) => setAccepted((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(key); else next.delete(key);
                        return next;
                      })}
                    />
                    <span className="text-sm"><span className="font-semibold">{acknowledgement.acknowledgementId}</span> <span className="text-base-content/50">version {acknowledgement.acknowledgementVersion}</span></span>
                  </label>
                );
              })}
            </fieldset>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-base-200 p-4">
            <input type="checkbox" className="checkbox checkbox-primary checkbox-sm mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span className="text-sm leading-5">I confirm that this property operates in {countryLabel(selectedPolicy.operatingCountryCode)} and that these deployment policy coordinates are correct.</span>
          </label>

          {error != null && <ErrorState error={error} title="Couldn't enable data processing" />}
          <FormActions submitting={pending} disabled={!canSubmit} submitLabel={processing.configuredStatus === "suspended" ? "Resume processing" : processing.governancePolicy ? "Apply policy" : "Enable processing"} onCancel={onClose} />
        </form>
      )}
    </Modal>
  );
}

function SuspendProcessingModal({ open, state, authorityCurrent, pending, error, onClose, onConfirm }: {
  open: boolean;
  state: PropertyProcessingState;
  authorityCurrent: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  return (
    <Modal open={open} title="Suspend data processing" description="Pause new guest, reservation and adapter writes for this property." onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (authorityCurrent && confirmed) onConfirm(); }} className="space-y-4">
        {!authorityCurrent && <ProcessingAuthorityNotice />}
        <div className="alert border border-warning/25 bg-warning/10 text-base-content">
          <ShieldAlert size={19} className="text-warning-content" />
          <p className="text-sm leading-5">Existing records are retained for authorized operations and cleanup. Resume requires a currently accepted country policy.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-base-200 p-4">
          <input type="checkbox" className="checkbox checkbox-primary checkbox-sm mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span className="text-sm leading-5">I understand that new property-scoped personal-data processing will be blocked.</span>
        </label>
        {error != null && <ErrorState error={error} title="Couldn't suspend data processing" />}
        <FormActions submitting={pending} disabled={!authorityCurrent || !confirmed || state.configuredStatus !== "enabled"} submitLabel="Suspend processing" onCancel={onClose} />
      </form>
    </Modal>
  );
}

function ProcessingAuthorityNotice() {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <ShieldAlert size={18} className="text-warning-content" />
      <p className="text-sm">Refresh property access and processing context before making this change.</p>
    </div>
  );
}

function PickerField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>{children}</div>;
}

function retentionPolicyKey(policy: { retentionPolicyId: string; retentionPolicyVersion: number }): string {
  return `${policy.retentionPolicyId}:${policy.retentionPolicyVersion}`;
}

function acknowledgementKey(id: string, version: number): string {
  return `${id}:${version}`;
}

function countryLabel(code: string): string {
  try {
    return `${new Intl.DisplayNames([navigator.language], { type: "region" }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function requireProcessingAuthority(allowed: boolean, message: string): void {
  if (!allowed) throw new Error(message);
}
