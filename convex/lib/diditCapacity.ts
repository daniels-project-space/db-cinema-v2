const diditApi = "https://verification.didit.me";
const unavailable = "Identity verification is temporarily unavailable. Please contact us before paying.";

function usdUnits(value: unknown): number | null {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const units = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  return Number.isSafeInteger(units) ? units : null;
}

/** Live sessions need prepaid PoA credit. Check it before taking a rental payment,
 * and stop checkout if the workflow changes beyond the agreed price ceiling. */
export async function assertDiditCheckoutCapacity(
  apiKey: string,
  workflowId: string,
  environment: string,
  maxPriceUsd: string | undefined,
  request: typeof fetch = fetch,
): Promise<void> {
  if (environment !== "live") return;
  const ceiling = usdUnits(maxPriceUsd);
  if (ceiling === null || ceiling <= 0) throw new Error(unavailable);
  try {
    const headers = { "x-api-key": apiKey };
    const [workflowsResponse, balanceResponse] = await Promise.all([
      request(`${diditApi}/v3/workflows/?limit=50`, { headers, signal: AbortSignal.timeout(5000) }),
      request(`${diditApi}/v3/billing/balance/`, { headers, signal: AbortSignal.timeout(5000) }),
    ]);
    if (!workflowsResponse.ok || !balanceResponse.ok) throw new Error("Didit API unavailable");
    const [workflows, credit] = await Promise.all([workflowsResponse.json(), balanceResponse.json()]);
    const latest = (Array.isArray(workflows?.results) ? workflows.results : [])
      .filter((item: any) => item.workflow_id === workflowId && item.status === "published")
      .sort((a: any, b: any) => b.version - a.version)[0];
    const required = new Set(["OCR", "LIVENESS", "FACE_MATCH", "PROOF_OF_ADDRESS"]);
    const features = new Set(String(latest?.features ?? "").split(/\s*\+\s*/));
    const price = usdUnits(latest?.max_price);
    const balance = usdUnits(credit?.balance);
    if (!latest || [...required].some((feature) => !features.has(feature)) ||
        price === null || price <= 0 || price > ceiling || balance === null || balance < price)
      throw new Error("Didit workflow or credit unavailable");
  } catch {
    throw new Error(unavailable);
  }
}
