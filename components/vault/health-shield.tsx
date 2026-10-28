"use client"

import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export type HealthStatus = "danger" | "warning" | "success" | "neutral"

interface HealthShieldProps {
  status: HealthStatus
  size?: "sm" | "md" | "lg"
  className?: string
}

// Spoken/announced wording: a full sentence fragment for screen readers.
const STATUS_DESCRIPTIONS: Record<HealthStatus, string> = {
  danger: "High risk; needs attention",
  warning: "Needs attention",
  success: "Healthy; no warnings",
  neutral: "Health status unknown",
}

// Short wording for the visible label printed next to the shield.
const STATUS_LABELS: Record<HealthStatus, string> = {
  danger: "High risk",
  warning: "Needs attention",
  success: "Healthy",
  neutral: "Status unknown",
}

// Text colours for that visible label, kept darker/lighter than the badge fill
// so the label itself stays above 4.5:1 against the card in both themes.
const STATUS_TEXT_STYLES: Record<HealthStatus, string> = {
  danger: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  success: "text-emerald-700 dark:text-emerald-400",
  neutral: "text-muted-foreground",
}

export function getHealthStatusLabel(status: HealthStatus): string {
  return STATUS_DESCRIPTIONS[status]
}

export function getHealthStatusText(status: HealthStatus): string {
  return STATUS_LABELS[status]
}

export function getHealthStatusTextClassName(status: HealthStatus): string {
  return STATUS_TEXT_STYLES[status]
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

  // Solid fills keep the badge itself above the 3:1 graphical-object contrast
  // minimum against the card in both themes; the glyph and ring take the
  // opposite tone so the shape reads even when colour is not perceived.
  const statusStyles: Record<HealthStatus, string> = {
    danger:
      "border-red-700 bg-red-600 text-white dark:border-red-400 dark:bg-red-500 dark:text-neutral-950",
    warning:
      "border-amber-700 bg-amber-700 text-white dark:border-amber-300 dark:bg-amber-400 dark:text-neutral-950",
    success:
      "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-300 dark:bg-emerald-400 dark:text-neutral-950",
    neutral:
      "border-neutral-500 bg-neutral-500 text-white dark:border-neutral-400 dark:bg-neutral-400 dark:text-neutral-950",
  }

  // A different silhouette per status so the meaning survives without colour.
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
