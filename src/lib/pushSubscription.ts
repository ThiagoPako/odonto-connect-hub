/**
 * Web Push subscription management
 * Registers SW, subscribes to push, and syncs with backend
 */

const VPS_API_BASE = 'https://odontoconnect.tech/api';
const TOKEN_KEY = 'odonto_jwt';

// VAPID public key — must match the one generated on the server
// Will be fetched from backend
let vapidPublicKey: string | null = null;

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getVapidKey(): Promise<string | null> {
  if (vapidPublicKey) return vapidPublicKey;
  try {
    const res = await fetch(`${VPS_API_BASE}/push/vapid-key`);
    if (!res.ok) return null;
    const data = await res.json();
    vapidPublicKey = data.publicKey;
    return vapidPublicKey;
  } catch {
    return null;
  }
}

export async function registerPushSubscription(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    // Register service worker (skip in iframe/preview)
    const isInIframe = (() => {
      try { return window.self !== window.top; } catch { return true; }
    })();
    const isPreview = window.location.hostname.includes('id-preview--') ||
      window.location.hostname.includes('lovableproject.com');
    if (isInIframe || isPreview) return false;

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const publicKey = await getVapidKey();
    if (!publicKey) {
      console.warn('Push: VAPID key not available from server');
      return false;
    }

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    // Send subscription to backend
    const res = await fetch(`${VPS_API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    return res.ok;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return false;
  }
}

export async function unregisterPushSubscription(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      // Remove from server
      await fetch(`${VPS_API_BASE}/push/unsubscribe`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
}
