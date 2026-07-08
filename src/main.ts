import { loadSmokeStatus, resolveApiBaseUrl, type SmokeResult } from "./app/smoke";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("BunkFy app root was not found.");
}

renderPending(app);

void loadSmokeStatus(resolveApiBaseUrl()).then((result) => {
  renderResult(app, result);
});

function renderPending(target: HTMLElement): void {
  target.innerHTML = `
    <section class="shell" aria-live="polite">
      <p class="eyebrow">BunkFy</p>
      <h1>Smoke shell</h1>
      <p class="muted">Checking API...</p>
    </section>
  `;
}

function renderResult(target: HTMLElement, result: SmokeResult): void {
  const statusClass = result.ok ? "status status-ok" : "status status-error";
  const statusText = result.ok ? "API online" : "API unavailable";
  const detail = result.ok
    ? `${result.data.service} responded at ${new Date(result.data.timestampUtc).toLocaleString()}`
    : result.message;
  const safeApiBaseUrl = escapeHtml(result.apiBaseUrl);
  const safeDetail = escapeHtml(detail);

  target.innerHTML = `
    <section class="shell" aria-live="polite">
      <p class="eyebrow">BunkFy</p>
      <h1>Smoke shell</h1>
      <div class="${statusClass}">
        <span aria-hidden="true"></span>
        <strong>${statusText}</strong>
      </div>
      <dl>
        <div>
          <dt>API</dt>
          <dd>${safeApiBaseUrl}</dd>
        </div>
        <div>
          <dt>Detail</dt>
          <dd>${safeDetail}</dd>
        </div>
      </dl>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
