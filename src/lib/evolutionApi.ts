// Evolution API client — connects to self-hosted instance on VPS
const EVOLUTION_API_URL = "https://api.odontoconnect.tech";
const EVOLUTION_API_KEY = "0a4c40e588465f7c078587511143c18cf979fcdf967b7debe58ef690a8907cbc";

interface EvolutionInstance {
  instanceName: string;
  instanceId: string;
  integration: string;
  status: string;
  owner?: string;
}

interface InstanceState {
  instanceName: string;
  state: "open" | "close" | "connecting";
}

interface QrCodeResponse {
  pairingCode: string | null;
  code: string;
  base64: string;
  count: number;
}

interface CreateInstancePayload {
  instanceName: string;
  integration?: string;
  qrcode?: boolean;
  number?: string;
}

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Evolution API error [${res.status}]: ${errorBody}`);
  }

  return res.json();
}

export async function fetchInstances(): Promise<EvolutionInstance[]> {
  const raw = await apiCall<any[]>("/instance/fetchInstances");
  return raw.map((inst) => ({
    instanceName: inst.name || inst.instanceName,
    instanceId: inst.id || inst.instanceId,
    integration: inst.integration || "",
    status: inst.connectionStatus || inst.status || "close",
    owner: inst.ownerJid || inst.owner,
  }));
}

export async function getInstanceState(instanceName: string): Promise<InstanceState> {
  return apiCall<InstanceState>(`/instance/connectionState/${instanceName}`);
}

export async function createInstance(payload: CreateInstancePayload) {
  return apiCall<{ instance: EvolutionInstance; qrcode?: QrCodeResponse }>(
    "/instance/create",
    {
      method: "POST",
      body: JSON.stringify({
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        ...payload,
      }),
    }
  );
}

export async function connectInstance(instanceName: string): Promise<QrCodeResponse> {
  return apiCall<QrCodeResponse>(`/instance/connect/${instanceName}`);
}

export async function logoutInstance(instanceName: string) {
  return apiCall(`/instance/logout/${instanceName}`, { method: "DELETE" });
}

export async function deleteInstance(instanceName: string) {
  return apiCall(`/instance/delete/${instanceName}`, { method: "DELETE" });
}

export async function restartInstance(instanceName: string) {
  return apiCall(`/instance/restart/${instanceName}`, { method: "PUT" });
}

export { type EvolutionInstance, type InstanceState, type QrCodeResponse };
