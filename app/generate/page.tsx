import type { Metadata } from "next"

import { GeneratorWorkspace } from "@/app/generate/_components/generator-workspace"

export const metadata: Metadata = {
  title: "Generator · UNG Password Manager",
}

export default function GeneratePage() {
  return <GeneratorWorkspace />
}
