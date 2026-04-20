export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (payload?.error) return payload.error;
  }

  const text = await response.text().catch(() => "");
  return text || `Request failed with status ${response.status}`;
}

export async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }
  return response;
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  return response.json() as Promise<T>;
}

export async function getText(path: string, init?: RequestInit): Promise<string> {
  const response = await apiRequest(path, init);
  return response.text();
}

export async function sendJson<TResponse>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<TResponse> {
  return getJson<TResponse>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
