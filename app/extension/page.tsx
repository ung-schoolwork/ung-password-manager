import type { Metadata } from "next"
import type { ReactNode } from "react"
import {
  Download,
  KeyRound,
  LockKeyhole,
  SquarePlus,
  type LucideIcon,
} from "lucide-react"

import { ExtensionPageFrame } from "@/app/extension/_components/extension-page-frame"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  EXTENSION_DOWNLOAD_FILE,
  EXTENSION_DOWNLOAD_PATH,
  EXTENSION_FOLDER_NAME,
} from "@/extension/download"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Chrome extension · UNG Password Manager",
  description:
    "Fill and save your logins in Chrome with the UNG Password Manager extension.",
}

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: KeyRound,
    title: "Fill saved logins",
    body: "On a sign-in page, open the extension and pick a login to fill in its username and password.",
  },
  {
    icon: SquarePlus,
    title: "Save new logins",
    body: "Save a login from the page you’re on. It appears in your vault wherever you sign in.",
  },
  {
    icon: LockKeyhole,
    title: "Your vault stays encrypted",
    body: "Your vault is unlocked only on your device, with your password. Everywhere else, it stays encrypted.",
  },
]

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Download and unzip the extension",
    body: (
      <>
        Unzipping gives you a folder named{" "}
        <span className="font-medium text-foreground">
          {EXTENSION_FOLDER_NAME}
        </span>
        . Keep it somewhere it won’t be deleted, because Chrome loads the
        extension from this folder.
      </>
    ),
  },
  {
    title: "Open the Extensions page",
    body: (
      <>
        Type{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
          chrome://extensions
        </code>{" "}
        into the address bar and press Enter.
      </>
    ),
  },
  {
    title: "Turn on Developer mode",
    body: "Use the switch in the top-right corner of the Extensions page.",
  },
  {
    title: "Select Load unpacked",
    body: (
      <>
        Choose the{" "}
        <span className="font-medium text-foreground">
          {EXTENSION_FOLDER_NAME}
        </span>{" "}
        folder. UNG Password Manager appears in your list of extensions.
      </>
    ),
  },
  {
    title: "Pin it to your toolbar",
    body: "Select the puzzle-piece icon next to the address bar, then select the pin next to UNG Password Manager.",
  },
]

export default function ExtensionPage() {
  return (
    <ExtensionPageFrame>
      <div className="mx-auto max-w-5xl space-y-10">
        <section className="max-w-2xl space-y-5">
          <p className="text-sm font-medium text-primary">Browser extension</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Your vault, right where you sign in
          </h1>
          <p className="text-base text-muted-foreground">
            The UNG Password Manager extension fills your saved logins and saves
            new ones without leaving the page you’re on.
          </p>
          <div>
            <a
              className={cn(
                buttonVariants(),
                "h-11 gap-2 px-5 text-sm [&_svg:not([class*='size-'])]:size-4"
              )}
              href={EXTENSION_DOWNLOAD_PATH}
              download={EXTENSION_DOWNLOAD_FILE}
            >
              <Download aria-hidden="true" />
              Download for Chrome
            </a>
          </div>
          <p className="text-sm text-muted-foreground">
            Works in Google Chrome and other Chromium-based browsers, such as
            Microsoft Edge and Brave.
          </p>
        </section>

        <section aria-labelledby="features-heading">
          <h2 id="features-heading" className="sr-only">
            What the extension does
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Card className="h-full">
                  <CardHeader className="gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-base">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="install-heading">
          <Card>
            <CardHeader>
              <h2
                id="install-heading"
                className="font-heading text-xl font-medium"
              >
                Install the extension
              </h2>
              <p className="text-sm text-muted-foreground">
                It takes about a minute.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <ol className="space-y-5">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div className="space-y-1 pt-1">
                      <h3 className="text-sm font-medium">{step.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="rounded-lg bg-muted/60 p-4 text-sm">
                <p className="font-medium">Then sign in</p>
                <p className="mt-1 text-muted-foreground">
                  Select UNG Password Manager in your toolbar and sign in with
                  your account. If it shows a code, enter that code under “Add a
                  device” in Settings on a device you already use.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </ExtensionPageFrame>
  )
}
