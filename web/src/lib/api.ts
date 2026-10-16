let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method))
    headers.set("x-csrf-token", csrfToken);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    if (response.status === 403 && data.error === "Invalid CSRF token")
      window.dispatchEvent(new Event("csrf-invalid"));
    const detail = data.error;
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : detail?.message ||
            data.errors
              ?.map(
                (e: { field: string; message: string }) =>
                  `${e.field}: ${e.message}`,
              )
              .join("; ") ||
            `Falha na requisição (${response.status})`,
      response.status,
      data.errors,
    );
  }
  return data as T;
}
export function post<T = any>(path: string, body: unknown = {}) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}
export function queryString(
  values: Record<string, string | number | undefined>,
) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== "" && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
