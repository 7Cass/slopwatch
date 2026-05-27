import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-slate-900 text-white",
        muted: "border-slate-200 bg-slate-50 text-slate-700",
        warning: "border-amber-200 bg-amber-50 text-amber-800",
        danger: "border-rose-200 bg-rose-50 text-rose-800",
        success: "border-emerald-200 bg-emerald-50 text-emerald-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
