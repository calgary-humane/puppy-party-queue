import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const { pin, counsellors } = await req.json().catch(() => ({}));

  if (!pin || pin !== process.env.ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!Array.isArray(counsellors)) {
    return NextResponse.json({ error: "Invalid counsellors" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Update the first settings row; if none, insert.
  const { data: existing } = await supabase.from("settings").select("id").limit(1).maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from("settings").update({ counsellors }).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("settings").insert({ counsellors });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
