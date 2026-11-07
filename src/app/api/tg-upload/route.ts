import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { MAX_RECEIPT_BYTES, ReceiptUploadError, uploadReceiptPhoto } from "@/lib/receipt-upload";
import { receiptPhotoUrl } from "@/lib/tg-photo-sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: Request) => {
  await getAuth(req);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_RECEIPT_BYTES)
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 413 });

  try {
    const fileId = await uploadReceiptPhoto(
      await file.arrayBuffer(),
      file.type,
      file.name || "receipt.jpg",
    );
    return NextResponse.json({ fileId, url: receiptPhotoUrl(fileId) });
  } catch (err) {
    if (err instanceof ReceiptUploadError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
});
