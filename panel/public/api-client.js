// Cliente HTTP del panel (puro, importable en Node): añade la cabecera anti-CSRF, envía la cookie de sesión
// y avisa (onUnauthorized) cuando el servidor responde 401 fuera del login. Fase 4: un 401 con reauthRequired
// (confirmar la contraseña por el túnel) NO cierra la sesión: lo atiende withReauth en la interfaz.

const LOGIN_PATH = '/api/auth/login';
// Una contraseña incorrecta al reconfirmar también responde 401 y no debe cerrar la sesión (fase 4).
const REAUTH_PATH = '/api/auth/reauth';

/**
 * Crea `request(url, init)`: devuelve el JSON de la respuesta (null en 204) o lanza un Error con
 * `status` y `payload` ({ error, field? }). Un 401 en una ruta distinta del login invoca onUnauthorized().
 */
export function createApiClient({ fetch = globalThis.fetch, onUnauthorized = () => {} } = {}) {
  return async function request(url, init = {}) {
    const headers = { Accept: 'application/json', 'X-Requested-With': 'fetch', ...(init.headers || {}) };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
    let payload = null;
    if (res.status !== 204) {
      const text = await res.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
    }
    if (!res.ok) {
      const message = payload && typeof payload.error === 'string' ? payload.error : `Error HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.payload = payload && typeof payload === 'object' ? payload : { error: message };
      const reauthRequired = Boolean(payload && payload.reauthRequired === true);
      const passwordCheck = String(url).endsWith(LOGIN_PATH) || String(url).endsWith(REAUTH_PATH);
      if (res.status === 401 && !reauthRequired && !passwordCheck) onUnauthorized();
      throw err;
    }
    return payload;
  };
}
