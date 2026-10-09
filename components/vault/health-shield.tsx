"use client"

import { Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export type HealthStatus = "danger" | "warning" | "success" | "neutral"

interface HealthShieldProps {
  status: HealthStatus
  size?: "sm" | "md" | "lg"
  className?: string
}

export function HealthShield({ status, size = "md", className }: HealthShieldProps) {
  const sizeClasses = {
    sm: "size-6",
    md: "size-8",
    lg: "size-11"
  }

  const iconSizeClasses = {
    sm: "size-3.5",
    md: "size-4.5",
    lg: "size-6"
  }

  // Maps the status strings to your specific requested colors using Tailwind
  const statusStyles = {
    danger: "bg-red-600 text-white border-red-500",
    warning: "bg-yellow-400 text-black border-yellow-300",
    success: "bg-emerald-500 text-white border-emerald-400",
    neutral: "bg-muted text-muted-foreground border-border"
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border shadow-inner transition-colors",
        sizeClasses[size],
        statusStyles[status],
        className
      )}
    >
      {/* Exclamation for danger/warning, Checkmark for success */}
      {status === "success" && <ShieldCheck className={iconSizeClasses[size]} strokeWidth={2.5} />}
      {status === "danger" && <ShieldAlert className={iconSizeClasses[size]} strokeWidth={2.5} />}
      {status === "warning" && <ShieldAlert className={iconSizeClasses[size]} strokeWidth={2.5} />}
      {status === "neutral" && <Shield className={iconSizeClasses[size]} strokeWidth={2} />}
    </div>
  )
}
