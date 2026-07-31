"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  ref?: React.Ref<React.ComponentRef<typeof SwitchPrimitive.Root>>;
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[27px] w-[46px] shrink-0 cursor-pointer items-center rounded-full border border-border shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[21px] translate-x-0.5 rounded-full bg-white shadow-md transition-transform data-[state=checked]:translate-x-[19px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
