import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A form field's label. `as="span"` names a field that has no single control to point at
 * (a photo list, a picker made of buttons), so it still reads like every other label.
 */
function Label({
  className,
  as = "label",
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  ref?: React.Ref<HTMLLabelElement>;
  as?: "label" | "span";
}) {
  const Tag = as;
  return (
    <Tag
      className={cn(
        "text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    />
  );
}

export { Label };
