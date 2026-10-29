"use client"

import { useAccount } from "@/components/auth/account-provider"
import { DeviceSettings } from "@/components/settings/device-settings"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function SettingsWorkspace() {
  const { session } = useAccount()

  if (!session) return null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-medium">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account and the devices that can open your vault.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
          <CardDescription className="text-sm">
            The email address you use to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="text-sm font-medium break-all">{session.user.email}</p>
        </CardContent>
      </Card>

      <DeviceSettings accountId={session.user.id} />
    </div>
  )
}
