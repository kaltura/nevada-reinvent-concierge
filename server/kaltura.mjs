/**
 * Kaltura agent sessions without any secret. A public widget id mints a
 * short-lived widget session, and appInit trades it for the session the chat
 * and avatar use. Both ids ship in the package by design, like any web widget.
 * ARCHITECTURE.md § Identity.
 */
const OVP_URL = 'https://www.kaltura.com/api_v3';
const AGENTIC_URL = 'https://api.avatar.us.kaltura.ai/v1';

export function makeKaltura(widgetId) {
  let widgetKs = null;

  async function mintWidgetSession() {
    const res = await fetch(`${OVP_URL}/service/session/action/startWidgetSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ format: '1', widgetId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.ks !== 'string') throw new Error(`widget session failed (HTTP ${res.status})`);
    return data.ks;
  }

  return {
    /** @returns {Promise<{ks:string,conversationManagerUrl:string,srsBaseUrl:string,turnServerUrl:string}>} */
    async appInit() {
      // The widget session has no known lifetime: mint again when Kaltura rejects it.
      for (let attempt = 0; ; attempt += 1) {
        widgetKs ??= await mintWidgetSession();
        const res = await fetch(`${AGENTIC_URL}/application/appInit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `KS ${widgetKs}` },
          body: '{}',
        });
        if (res.status === 401 && attempt === 0) { widgetKs = null; continue; }
        const data = await res.json().catch(() => null);
        if (!res.ok || typeof data?.ks !== 'string') throw new Error(`appInit failed (HTTP ${res.status})`);
        const { ks, conversationManagerUrl, srsBaseUrl, turnServerUrl } = data;
        return { ks, conversationManagerUrl, srsBaseUrl, turnServerUrl };
      }
    },
  };
}
