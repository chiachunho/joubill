import type { ReactElement } from "react";

import { avatarColor, initials } from "./theme";

/** Circular avatar: profile photo if available, else an initials disc. */
export function CardAvatar({
  userId,
  name,
  dataUrl,
  size,
}: {
  userId: number;
  name: string;
  dataUrl: string | null;
  size: number;
}): ReactElement {
  if (dataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={dataUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: size / 2, objectFit: "cover" }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(userId),
        color: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
      }}
    >
      {initials(name)}
    </div>
  );
}
