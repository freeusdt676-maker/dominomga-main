import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "primary" | "success" | "danger" | "warning" | "info";
  badge?: number | string | null;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
};

// Band colors (couleur thème — tsy ovaina ny palette ankapobeny: gold/slate primaire)
const bandClasses: Record<NonNullable<Props["variant"]>, string> = {
  default: "bg-slate-600",
  primary: "bg-amber-600",
  success: "bg-emerald-600",
  danger: "bg-red-600",
  warning: "bg-orange-600",
  info: "bg-sky-600",
};

const iconColor: Record<NonNullable<Props["variant"]>, string> = {
  default: "text-slate-700",
  primary: "text-amber-600",
  success: "text-emerald-600",
  danger: "text-red-600",
  warning: "text-orange-600",
  info: "text-sky-600",
};

const sizeClasses: Record<NonNullable<Props["size"]>, { top: string; icon: string; label: string }> = {
  sm: { top: "h-12", icon: "[&>svg]:w-6 [&>svg]:h-6", label: "text-[10px] py-1.5" },
  md: { top: "h-14", icon: "[&>svg]:w-7 [&>svg]:h-7", label: "text-[11px] py-2" },
  lg: { top: "h-16", icon: "[&>svg]:w-8 [&>svg]:h-8", label: "text-xs py-2.5" },
};

/**
 * Tile bouton — logo/symbole eo ambony (fond fotsy), anarana eo ambany amin'ny
 * couleur band. Endrika mitovy manerana ny app (Home, Admin, Wallet...) mba
 * mizara tsara ao anaty grid iray monja.
 */
export default function CircleNavButton({
  icon,
  label,
  onClick,
  href,
  variant = "default",
  badge,
  active,
  size = "md",
  className,
  disabled,
}: Props) {
  const sz = sizeClasses[size];
  const Inner = (
    <span
      className={cn(
        "relative flex flex-col w-full rounded-lg overflow-hidden shadow-md ring-1 ring-black/10 bg-white transition-all select-none",
        active && "ring-2 ring-amber-400",
        !disabled && "hover:shadow-lg active:scale-[0.97]",
        disabled && "opacity-50 grayscale",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center bg-white",
          sz.top,
          sz.icon,
          iconColor[variant],
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "w-full text-center text-white font-semibold leading-tight px-1",
          bandClasses[variant],
          sz.label,
        )}
      >
        <span className="block truncate">{label}</span>
      </span>
      {badge != null && Number(badge) > 0 && (
        <span className="absolute top-1 right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
          {badge}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <a href={href} className={cn("flex w-full", className)}>
        {Inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("flex w-full", className)}
    >
      {Inner}
    </button>
  );
}