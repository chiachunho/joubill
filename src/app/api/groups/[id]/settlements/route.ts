import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { createSettlement } from "@/lib/records";
import { settlementInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A settlement is stored as a `type='settlement'` expense: the sole payer is the
// sender (from) and the sole debtor is the receiver (to). There is no list GET
// here — settlements appear in the main list at `GET …/expenses`.
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const parsed = settlementInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { id } = await createSettlement(groupId, parsed.data, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ id }, { status: 201 });
});
