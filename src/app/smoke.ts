export type SmokeStatus = {
  application: string;
  service: string;
  status: string;
  gmaModulesEnabled: boolean;
  timestampUtc: string;
};

export type SmokeResult =
  | { ok: true; apiBaseUrl: string; data: SmokeStatus }
  | { ok: false; apiBaseUrl: string; message: string };

export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_BUNKFY_API_BASE_URL?.trim();
  return trimTrailingSlash(configured || "http://localhost:5194");
}

export async function loadSmokeStatus(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<SmokeResult> {
  const normalizedApiBaseUrl = trimTrailingSlash(apiBaseUrl);

  try {
    const response = await fetcher(`${normalizedApiBaseUrl}/api/smoke`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        apiBaseUrl: normalizedApiBaseUrl,
        message: `API returned HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      apiBaseUrl: normalizedApiBaseUrl,
      data: (await response.json()) as SmokeStatus,
    };
  } catch (error) {
    return {
      ok: false,
      apiBaseUrl: normalizedApiBaseUrl,
      message: error instanceof Error ? error.message : "Unable to reach API",
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
