import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Radio, RefreshCw } from "lucide-react";

/**
 * Live near-Earth object traffic, straight from NASA's Near-Earth Object Web
 * Service. This is the same public feed mission operators use; the demo key is
 * NASA's own anonymous tier, so it is rate limited and sometimes busy.
 */

type Neo = {
  id: string;
  name: string;
  diameterMinKm: number | null;
  diameterMaxKm: number | null;
  isHazardous: boolean;
  velocityKph: number | null;
  missDistanceKm: number | null;
};

type Feed = {
  fetchedAt: number;
  latencyMs: number;
  count: number;
  ok: boolean;
  error?: string;
  neos: Neo[];
};

const ENDPOINT =
  "https://api.nasa.gov/neo/rest/v1/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&api_key=DEMO_KEY";

async function loadFeed(signal?: AbortSignal): Promise<Feed> {
  const started = performance.now();
  const today = new Date();
  const end = new Date(today.getTime() + 7 * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = ENDPOINT.replace("YYYY-MM-DD", fmt(today)).replace(
    /YYYY-MM-DD(?!.*YYYY)/,
    fmt(end),
  );
  const res = await fetch(url, { signal });
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) {
    return {
      fetchedAt: Date.now(),
      latencyMs,
      count: 0,
      ok: false,
      error: `NeoWs answered ${res.status}. The public demo key is rate limited — try again shortly.`,
      neos: [],
    };
  }
  const json = (await res.json()) as {
    near_earth_objects?: {
      id: string;
      name: string;
      is_potentially_hazardous_asteroid: boolean;
      estimated_diameter?: { kilometers?: { estimated_diameter_min?: number; estimated_diameter_max?: number } };
      close_approach_data?: {
        relative_velocity?: { kilometers_per_hour?: number };
        miss_distance?: { kilometers?: number };
      }[];
    }[];
  };
  const neos: Neo[] = (json.near_earth_objects ?? []).map((n) => {
    const d = n.estimated_diameter?.kilometers;
    return {
      id: n.id,
      name: n.name,
      diameterMinKm: d?.estimated_diameter_min ?? null,
      diameterMaxKm: d?.estimated_diameter_max ?? null,
      isHazardous: Boolean(n.is_potentially_hazardous_asteroid),
      velocityKph:
        n.close_approach_data?.[0]?.relative_velocity?.kilometers_per_hour ?? null,
      missDistanceKm:
        n.close_approach_data?.[0]?.miss_distance?.kilometers ?? null,
    };
  });
  return { fetchedAt: Date.now(), latencyMs, count: neos.length, ok: true, neos };
}

export function NeoWsDrawer() {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFeed(await loadFeed());
    } catch (e) {
      setFeed({
        fetchedAt: Date.now(),
        latencyMs: 0,
        count: 0,
        ok: false,
        error: e instanceof Error ? e.message : "NeoWs is unreachable.",
        neos: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !feed && !loading) void refresh();
  }, [open, feed, loading, refresh]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Radio className="size-3.5" />
          Near-Earth traffic
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Near-Earth object traffic</SheetTitle>
          <SheetDescription>
            Objects that will come within 1.5 astronomical units of Earth over the next
            seven days, from NASA&apos;s Near-Earth Object Web Service.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${feed?.ok ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {feed
              ? `${feed.ok ? "live" : "degraded"} · ${feed.latencyMs} ms · ${feed.count} objects`
              : loading
                ? "connecting…"
                : "idle"}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {feed?.error && (
          <p className="mt-4 rounded-sm border border-border p-3 text-[12px] text-muted-foreground">
            {feed.error}
          </p>
        )}

        <ul className="mt-6 space-y-2">
          {feed?.neos.map((n) => (
            <li key={n.id} className="rounded-sm border border-border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">
                  {n.name.replace(/^\(|\)$/g, "")}
                </span>
                {n.isHazardous && (
                  <Badge variant="outline" className="rounded-sm text-[10px]">
                    <AlertTriangle className="mr-1 size-3" />
                    hazardous
                  </Badge>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-muted-foreground">
                <div>
                  <dt>size</dt>
                  <dd className="text-foreground">
                    {n.diameterMinKm !== null && n.diameterMaxKm !== null
                      ? `${Math.round(n.diameterMinKm * 1000)}–${Math.round(n.diameterMaxKm * 1000)} m`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>speed</dt>
                  <dd className="text-foreground">
                    {n.velocityKph ? `${Math.round(n.velocityKph).toLocaleString()} km/h` : "—"}
                  </dd>
                </div>
                <div>
                  <dt>miss</dt>
                  <dd className="text-foreground">
                    {n.missDistanceKm ? `${Math.round(n.missDistanceKm).toLocaleString()} km` : "—"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        {feed?.ok && feed.neos.length === 0 && (
          <p className="mt-6 text-[13px] text-muted-foreground">
            No near-Earth approaches in the coming week. Quiet sky.
          </p>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
          This drawer is context, not the experiment. The blink comparator is: it looks for
          bodies that move between two SPHEREx survey epochs, hours to degrees away, where
          this feed only tracks the handful that come near Earth.
        </p>
      </SheetContent>
    </Sheet>
  );
}
