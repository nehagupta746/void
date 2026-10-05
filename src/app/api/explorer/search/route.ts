import { NextRequest, NextResponse } from "next/server";
import { explorerErrorResponse } from "@/lib/api/route-error";
import { searchNeoObjects } from "@/lib/api/nasa-explorer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    return NextResponse.json(await searchNeoObjects(query), { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return explorerErrorResponse(error);
  }
}
