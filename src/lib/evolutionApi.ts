// Evolution API client — connects to self-hosted instance on VPS
const EVOLUTION_API_URL = "https://api.odontoconnect.tech";
const EVOLUTION_API_KEY = "0a4c40e588465f7c078587511143c18cf979fcdf967b7debe58ef690a8907cbc";

type ConnectionStatus = "open" | "close" | "connecting";

interface EvolutionInstance {
  instanceName: string;
  instanceId: string;
  integration: string;
  status: ConnectionStatus;
  owner?: string;
}

interface InstanceState {
  instanceName: string;
  state: ConnectionStatus;
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

function normalizeStatus(value: unknown): ConnectionStatus {
  return value === "open" || value === "connecting" ? value : "close";
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
    status: normalizeStatus(inst.connectionStatus || inst.status),
    owner: inst.ownerJid || inst.owner,
  }));
}

export async function getInstanceState(instanceName: string): Promise<InstanceState> {
  const raw = await apiCall<any>(`/instance/connectionState/${instanceName}`);
  const instance = raw?.instance ?? raw;

  return {
    instanceName: instance?.instanceName || instanceName,
    state: normalizeStatus(instance?.state),
  };
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
  const raw = await apiCall<any>(`/instance/connect/${instanceName}`);
  const qr = raw?.qrcode ?? raw;

  return {
    pairingCode: qr?.pairingCode ?? null,
    code: qr?.code ?? "",
    base64: qr?.base64 ?? "",
    count: typeof qr?.count === "number" ? qr.count : 0,
  };
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

export async function sendTextMessage(
  instanceName: string,
  number: string,
  text: string
): Promise<{ key: { id: string } }> {
  const cleanNumber = number.replace(/\D/g, "");
  return apiCall(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ number: cleanNumber, text }),
  });
}

/** Send media (image, video, document) via base64 or URL */
export async function sendMediaMessage(
  instanceName: string,
  number: string,
  mediaType: "image" | "video" | "document" | "audio",
  media: { base64?: string; url?: string; fileName?: string; caption?: string; mimeType?: string }
): Promise<{ key: { id: string } }> {
  const cleanNumber = number.replace(/\D/g, "");

  if (mediaType === "audio") {
    // Audio uses sendWhatsAppAudio endpoint
    return apiCall(`/message/sendWhatsAppAudio/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: cleanNumber,
        audio: media.base64 ? `data:${media.mimeType || "audio/ogg"};base64,${media.base64}` : media.url,
      }),
    });
  }

  const endpoint =
    mediaType === "image" ? "sendMedia" :
    mediaType === "video" ? "sendMedia" :
    "sendMedia";

  const payload: Record<string, unknown> = {
    number: cleanNumber,
    mediatype: mediaType,
    caption: media.caption || "",
    fileName: media.fileName || undefined,
  };

  if (media.base64) {
    payload.media = `data:${media.mimeType || "application/octet-stream"};base64,${media.base64}`;
  } else if (media.url) {
    payload.media = media.url;
  }

  return apiCall(`/message/${endpoint}/${instanceName}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface WhatsAppContact {
  id: string;
  pushName?: string;
  profilePictureUrl?: string;
}

export async function fetchWhatsAppContacts(instanceName: string): Promise<WhatsAppContact[]> {
  const raw = await apiCall<any[]>(`/chat/findContacts/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return (raw || [])
    .filter((c: any) => c.id?.endsWith("@s.whatsapp.net"))
    .map((c: any) => ({
      id: c.id.replace("@s.whatsapp.net", ""),
      pushName: c.pushName || c.name || "",
      profilePictureUrl: c.profilePictureUrl || "",
    }));
}

export { type ConnectionStatus, type EvolutionInstance, type InstanceState, type QrCodeResponse };
