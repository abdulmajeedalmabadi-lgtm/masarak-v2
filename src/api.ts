export const base = import.meta.env.VITE_API_URL ?? "";
export async function api<T = any>(
  path: string,
  token?: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + "/api" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Error("networkError");
  }
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "serverError");
  return data;
}
