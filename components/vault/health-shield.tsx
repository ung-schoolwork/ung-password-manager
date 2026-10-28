"use client"

import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export type HealthStatus = "danger" | "warning" | "success" | "neutral"

interface HealthShieldProps {
  status: HealthStatus
  size?: "sm" | "md" | "lg"
  className?: string
}

export function getHealthStatusLabel(status: HealthStatus): string {
  const labels: Record<HealthStatus, string> = {
    danger: "High risk; needs attention",
    warning: "Needs attention",
    success: "Healthy; no warnings",
    neutral: "Health status unknown",
  }

  return labels[status]
}

export function HealthShield({
  status,
  size = "md",
  className,
}: HealthShieldProps) {
  const sizeClasses = {
    sm: "size-6",
    md: "size-8",
    lg: "size-11",
  }

  const iconSizeClasses = {
    sm: "size-3.5",
    md: "size-4.5",
    lg: "size-6",
  }

  const statusStyles = {
    danger:
      "bg-red-100 text-red-800 border-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-200",
    warning:
      "bg-amber-100 text-amber-900 border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-200",
    success:
      "bg-emerald-100 text-emerald-900 border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-200",
    neutral: "bg-muted text-foreground border-foreground",
  }
  const StatusIcon = {
    danger: ShieldAlert,
    warning: AlertTriangle,
    success: ShieldCheck,
    neutral: Shield,
  }[status]

  return (
    <div
      role="img"
      aria-label={getHealthStatusLabel(status)}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border shadow-inner transition-colors",
        sizeClasses[size],
        statusStyles[status],
        className
      )}
    >
      <StatusIcon
        className={iconSizeClasses[size]}
        strokeWidth={status === "neutral" ? 2 : 2.5}
        aria-hidden="true"
      />
    </div>
  )
}
