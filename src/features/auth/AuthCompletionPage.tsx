import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/session";
import { BrandMark } from "../../components/ui/BrandMark";

export function AuthCompletionPage() {
  const { completeExternalAuthentication, isRestoring, session } = useSession();
  const started = useRef(false);
  const [error, setError] = useState("");
  const parameters = new URLSearchParams(window.location.search);
  const code = parameters.get("code") || "";
  const provider = parameters.get("provider") || "";
  const providerError = parameters.get("error");

  useEffect(() => {
    if (isRestoring || started.current) return;
    started.current = true;
    if (providerError) {
      setError("The external provider did not complete authentication.");
      return;
    }
    if (!code || !provider) {
      setError("The external authentication response is incomplete.");
      return;
    }

    void completeExternalAuthentication(code, provider)
      .then((destination) => window.location.replace(destination))
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "External authentication failed.",
        );
      });
  }, [
    code,
    completeExternalAuthentication,
    isRestoring,
    provider,
    providerError,
  ]);

  return (
    <main className="grid min-h-screen place-items-center bg-base-200 p-5">
      <section className="w-full max-w-md border border-base-300 bg-base-100 p-7 shadow-sm sm:p-9">
        <div className="flex items-center gap-3">
          <BrandMark variant="simple-white-bold" height={48} framed />
          <div>
            <p className="font-display text-xl font-semibold">BunkFy</p>
            <p className="text-xs text-base-content/45">
              Secure account handoff
            </p>
          </div>
        </div>
        {error ? (
          <div className="mt-8">
            <AlertTriangle className="text-error" size={28} />
            <h1 className="mt-4 font-display text-2xl font-semibold">
              Authentication could not be completed
            </h1>
            <p className="mt-3 text-sm leading-6 text-base-content/60">
              {error}
            </p>
            <a
              className="btn btn-primary mt-6 w-full"
              href={session ? "/account" : "/"}
            >
              Return to BunkFy
            </a>
          </div>
        ) : (
          <div className="mt-8" aria-live="polite">
            {isRestoring ? (
              <LoaderCircle className="animate-spin text-primary" size={30} />
            ) : (
              <CheckCircle2 className="text-primary" size={30} />
            )}
            <h1 className="mt-4 font-display text-2xl font-semibold">
              Completing authentication
            </h1>
            <p className="mt-3 text-sm leading-6 text-base-content/60">
              Please keep this page open while BunkFy verifies the provider
              response.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
