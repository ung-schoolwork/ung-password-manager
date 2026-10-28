"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MonitorSmartphone } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { approveDevice, fetchDevices, removeDevice } from "@/lib/devices/client"
import {
  DEVICE_CODE_LENGTH,
  DeviceNotApprovedError,
  normalizeDeviceCode,
} from "@/lib/devices/shared"

const DEVICES_POLL_INTERVAL_MS = 30_000

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function lastActive(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
}

export function DeviceSettings({ accountId }: { accountId: string }) {
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null
  )
  const queryClient = useQueryClient()
  const devicesKey = ["devices", accountId]

  const devices = useQuery({
    queryKey: devicesKey,
    queryFn: fetchDevices,
    retry: false,
    refetchInterval: DEVICES_POLL_INTERVAL_MS,
  })

  const approve = useMutation({
    mutationFn: approveDevice,
    onSuccess: (result) => {
      setCode("")
      setError(null)
      setNotice(`${result.device.name} can now open your vault.`)
      void queryClient.invalidateQueries({ queryKey: devicesKey })
    },
    onError: (caught) => {
      setNotice(null)
      setError(errorMessage(caught, "The device could not be approved."))
    },
  })

  const remove = useMutation({
    mutationFn: removeDevice,
    onSuccess: () => {
      setConfirmingRemoval(null)
      setError(null)
      setNotice("Device removed. It can no longer open your vault.")
      void queryClient.invalidateQueries({ queryKey: devicesKey })
    },
    onError: (caught) => {
      setConfirmingRemoval(null)
      setNotice(null)
      setError(errorMessage(caught, "The device could not be removed."))
    },
  })

  function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    const normalized = normalizeDeviceCode(code)
    if (!normalized) {
      setError(
        `Enter the ${DEVICE_CODE_LENGTH}-digit code shown on the new device.`
      )
      return
    }
    setError(null)
    approve.mutate(normalized)
  }

  const waitingForApproval = devices.error instanceof DeviceNotApprovedError

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Approved devices</CardTitle>
        <CardDescription className="text-sm">
          Only approved devices can open your vault and receive changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {waitingForApproval ? (
          <p className="text-sm text-muted-foreground">
            This device is waiting for approval. Approve it from a device you
            already use.
          </p>
        ) : devices.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading devices…
          </p>
        ) : devices.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(devices.error, "Your devices could not be loaded.")}
          </p>
        ) : (
          <>
            <ul className="space-y-2" aria-label="Approved devices">
              {devices.data.map((device) => (
                <li
                  key={device.id}
                  className="space-y-2 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <MonitorSmartphone
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {device.name}
                        {device.current ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            This device
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last active {lastActive(device.lastSeenAt)}
                      </p>
                    </div>
                    {device.current ||
                    confirmingRemoval === device.id ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`Remove ${device.name}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          setNotice(null)
                          setError(null)
                          setConfirmingRemoval(device.id)
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {confirmingRemoval === device.id ? (
                    <div
                      role="group"
                      aria-label={`Confirm removing ${device.name}`}
                      className="space-y-2"
                    >
                      <p className="text-sm">
                        Remove {device.name}? It will need to be approved again
                        before it can open your vault.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(device.id)}
                        >
                          Remove device
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={remove.isPending}
                          onClick={() => setConfirmingRemoval(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <form className="space-y-2 border-t pt-5" onSubmit={handleApprove}>
              <Label htmlFor="device-code">Add a device</Label>
              <p
                id="device-code-help"
                className="text-xs text-muted-foreground"
              >
                Sign in on the new device, then enter the code it shows here.
              </p>
              <div className="flex gap-2">
                <Input
                  id="device-code"
                  className="h-9 px-3 font-mono tracking-widest"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={DEVICE_CODE_LENGTH + 1}
                  value={code}
                  disabled={approve.isPending}
                  onChange={(event) => setCode(event.target.value)}
                  aria-describedby="device-code-help"
                />
                <Button
                  type="submit"
                  className="h-9 px-3"
                  disabled={approve.isPending || code.length === 0}
                >
                  {approve.isPending ? "Approving…" : "Approve device"}
                </Button>
              </div>
            </form>
          </>
        )}

        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
