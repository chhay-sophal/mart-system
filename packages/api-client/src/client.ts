import type { SyncPushRequest, SyncPushResponse } from "@mart-system/shared-types";
import { ApiError } from "./errors";
import { withRetry, type RetryOptions } from "./retry";

export interface ApiClientConfig {
  /** Injected per-app: e.g. the sidecar's discovered localhost port for `pos`, or the deployed backend URL for `ims`. */
  baseUrl: string;
  /** Returns the current bearer token (JWT, PIN session token, or device credential), if any. */
  getAuthToken?: () => string | null | Promise<string | null>;
  /** Called once when a request comes back 401/403, so the app can force a re-login. */
  onUnauthorized?: () => void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]) {
  const url = new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.config.getAuthToken?.();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(buildUrl(this.config.baseUrl, path, options.query), {
        method: options.method ?? "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (cause) {
      // Network failure (offline, sidecar not up yet, etc.) — status 0 distinguishes this from a real HTTP error.
      throw new ApiError(0, "Network request failed", cause);
    }

    if (response.status === 401 || response.status === 403) {
      this.config.onUnauthorized?.();
    }

    const text = await response.text();
    const data = text ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      throw new ApiError(response.status, `${options.method ?? "GET"} ${path} failed`, data);
    }

    return data as T;
  }

  get<T>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>(path, { method: "GET", query });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PUT", body });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  /**
   * Push a batch of POS outbox events. Wrapped in retry-with-backoff because
   * losing a sale to a transient network blip is not acceptable — the caller's
   * outbox rows stay PENDING until this resolves or the caller's own loop tries again.
   */
  pushSyncEvents(req: SyncPushRequest, retryOptions?: RetryOptions) {
    return withRetry(
      () => this.post<SyncPushResponse>("/api/sync/push", req),
      {
        shouldRetry: (error) => !(error instanceof ApiError) || error.isNetworkError || error.status >= 500,
        ...retryOptions,
      }
    );
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
