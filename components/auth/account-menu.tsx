"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, Settings } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="max-w-64 min-w-0 gap-2"
            aria-label="Signed-in account"
          />
        }
      >
        <span className="truncate">{email}</span>
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="space-y-4">
        <div>
          <PopoverTitle>Signed in as</PopoverTitle>
          <PopoverDescription className="break-all">{email}</PopoverDescription>
        </div>
        <Link
          className={cn(buttonVariants({ variant: "outline" }), "h-9 w-full")}
          href="/settings"
          onClick={() => setOpen(false)}
        >
          <Settings className="size-4" aria-hidden="true" />
          Settings
        </Link>
      </PopoverContent>
    </Popover>
  )
}
