import type { Metadata } from "next"

import { SettingsWorkspace } from "@/app/settings/_components/settings-workspace"

export const metadata: Metadata = {
  title: "Settings · UNG Password Manager",
}

export default function SettingsPage() {
  return <SettingsWorkspace />
}
