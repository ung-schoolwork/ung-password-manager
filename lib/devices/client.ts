import {
  DeviceNotApprovedError,
  type DeviceState,
  type DeviceSummary,
} from "@/lib/devices/shared"

export class DeviceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "DeviceRequestError"
  }
}

async function deviceRequest<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  fallback: string
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init.method,
      credentials: "same-origin",
      cache: "no-store",
      headers:
        init.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new DeviceRequestError(fallback, 0)
  }
  if (response.status === 403) throw new DeviceNotApprovedError()
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new DeviceRequestError(
      response.status === 404 && path.endsWith("/approve")
        ? "That code was not found. Check the code on the other device and try again."
        : response.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : fallback,
      response.status
    )
  return data as T
}

export function registerThisDevice(): Promise<DeviceState> {
  return deviceRequest(
    "/api/devices",
    { method: "POST", body: {} },
    "This device could not be checked. Try again."
  )
}

export async function fetchDevices(): Promise<DeviceSummary[]> {
  const data = await deviceRequest<{ devices: DeviceSummary[] }>(
    "/api/devices",
    { method: "GET" },
    "Your devices could not be loaded. Try again."
  )
  return data.devices
}

export function approveDevice(code: string) {
  return deviceRequest<{ device: { id: string; name: string } }>(
    "/api/devices/approve",
    { method: "POST", body: { code } },
    "The device could not be approved. Try again."
  )
}

export function removeDevice(id: string) {
  return deviceRequest<{ ok: true }>(
    `/api/devices/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "The device could not be removed. Try again."
  )
}
