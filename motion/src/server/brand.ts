/**
 * Brand fetcher: paste a website, get its name, colours and logo to use in a video. Extraction is
 * OpenBrand (https://openbrand.sh, the open-source npm library, run server-side, so no key needed).
 * Served at the same routes by the dev server (vite.config.ts) and the Vercel function (aiProxy.ts):
 *
 *   GET /api/brand?url=stripe.com          → Brand (below)
 *   GET /api/brand/image?url=<logo url>    → the image bytes, so the browser can import a logo it
 *                                            couldn't fetch itself (most sites don't allow CORS)
 */

export type Brand = {
  name: string;
  url: string;
  /** Up to six distinct colours, the site's main one first. */
  colors: { hex: string; usage?: string }[];
  /** Best logo first (vector or a named logo over a favicon, then the biggest). */
  logos: { url: string; width?: number; height?: number }[];
  /** A picture that represents the site (its share image), if it has one. */
  image?: string;
};

type Extracted = {
  brand_name: string;
  colors: { hex: string; usage?: string }[];
  logos: { url: string; type?: string; resolution?: { width: number; height: number } }[];
  backdrop_images: { url: string }[];
};
export type Extract = (url: string) => Promise<{ ok: true; data: Extracted } | { ok: false; error: { code: string; message: string } }>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Accept "stripe.com" as well as full links; refuse anything that isn't a public web address. */
export function normalizeUrl(input: string): URL | null {
  const s = input.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return null; // localhost, intranet names
  if (/\.(local|internal|localhost|lan|home|corp)$/.test(h)) return null;
  if (h.includes(":")) return null; // raw IPv6: no public use case here
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    const priv = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    if (priv) return null;
  }
  return u;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const full = (hex: string) => (hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex).toLowerCase();

/**
 * Logos lifted from inline <svg> markup often lack the xmlns attribute (fine inside HTML, but an
 * image won't decode without it) and a width; add both so the logo works as a picture.
 */
export function fixSvgDataUrl(url: string): string {
  const m = url.match(/^data:image\/svg\+xml(;base64)?,(.*)$/is);
  if (!m) return url;
  let svg: string;
  try {
    svg = m[1] ? new TextDecoder().decode(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))) : decodeURIComponent(m[2]);
  } catch {
    return url;
  }
  const open = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!open) return url;
  let tag = open;
  if (!/\sxmlns=/i.test(tag)) tag = tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const vb = tag.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i);
  if (vb && !/\swidth=/i.test(tag)) {
    const h = Number(tag.match(/\sheight="([\d.]+)"/i)?.[1]) || Number(vb[2]);
    const w = (Number(vb[1]) / Number(vb[2])) * h;
    tag = tag.replace(/^<svg/i, `<svg width="${Math.round(w * 100) / 100}"${/\sheight=/i.test(tag) ? "" : ` height="${h}"`}`);
  }
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(open, tag))}`;
}

export function shapeBrand(d: Extracted, url: string): Brand {
  const seen = new Set<string>();
  const colors: Brand["colors"] = [];
  const order = ["primary", "accent", "secondary", undefined, "background", "text"];
  const sorted = [...d.colors].sort((a, b) => order.indexOf(a.usage) - order.indexOf(b.usage));
  for (const c of sorted) {
    if (!HEX.test(c.hex ?? "")) continue;
    const hex = full(c.hex);
    if (seen.has(hex)) continue;
    seen.add(hex);
    colors.push(c.usage ? { hex, usage: c.usage } : { hex });
  }
  const score = (l: Extracted["logos"][number]) => {
    const px = l.resolution ? Math.min(l.resolution.width, l.resolution.height) : 0;
    const vector = /\.svg(\?|$)/i.test(l.url) || l.url.startsWith("data:image/svg") ? 400 : 0;
    const kind = l.type === "logo" || l.type === "svg" ? 600 : l.type === "apple-touch-icon" ? 150 : l.type === "favicon" ? 0 : 50;
    return kind + vector + Math.min(px, 512);
  };
  const logos = d.logos
    .filter((l) => l.url && !/^data:(?!image\/(svg|png|jpeg|webp))/i.test(l.url))
    .sort((a, b) => score(b) - score(a))
    .filter((l, i, all) => all.findIndex((x) => x.url === l.url) === i)
    .slice(0, 4)
    .map((l) => ({ ...l, url: fixSvgDataUrl(l.url) }))
    .map((l) => (l.resolution ? { url: l.url, width: l.resolution.width, height: l.resolution.height } : { url: l.url }));
  const name = (d.brand_name || new URL(url).hostname.replace(/^www\./, "").split(".")[0]).trim();
  return { name, url, colors: colors.slice(0, 6), logos, ...(d.backdrop_images[0]?.url ? { image: d.backdrop_images[0].url } : {}) };
}

const defaultExtract: Extract = async (url) => {
  const { extractBrandAssets } = await import("openbrand");
  return extractBrandAssets(url) as ReturnType<Extract>;
};

const MAX_IMAGE = 5 * 1024 * 1024;

/** `sub` is the path after /api/brand ("" or "image"); `search` carries ?url=. */
export async function handleBrandRequest(sub: string, search: URLSearchParams, extract: Extract = defaultExtract, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const raw = search.get("url") ?? "";
  if (sub === "image") {
    const u = normalizeUrl(raw);
    if (!u) return json(400, { error: "That isn't a public image link." });
    // follow redirects by hand so each hop is checked as a public address too
    let res: Response | null = null;
    let at: URL | null = u;
    for (let hop = 0; hop < 4 && at; hop++) {
      try {
        res = await fetchImpl(at.toString(), { headers: { accept: "image/*" }, redirect: "manual" });
      } catch {
        return json(502, { error: "Couldn't download the logo." });
      }
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      await res.body?.cancel();
      at = normalizeUrl(new URL(loc, at).toString());
      res = null;
    }
    if (!res) return json(502, { error: "Couldn't download the logo." });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\//i.test(type)) {
      await res.body?.cancel();
      return json(502, { error: "That link didn't return an image." });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE) return json(413, { error: "That logo is too large." });
    return new Response(buf, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
  }
  if (sub !== "") return json(404, { error: "unknown route" });
  const u = normalizeUrl(raw);
  if (!u) return json(400, { error: "Paste a website address, like stripe.com." });
  try {
    const r = await extract(u.toString());
    if (!r.ok) {
      const msg =
        r.error.code === "ACCESS_BLOCKED" ? "That site blocks automated visits, so its brand couldn't be read." :
        r.error.code === "NOT_FOUND" ? "That page wasn't found. Check the address." :
        r.error.code === "EMPTY_CONTENT" ? "That page came back empty." :
        "Couldn't reach that site.";
      return json(422, { error: msg });
    }
    return json(200, shapeBrand(r.data, u.toString()));
  } catch {
    return json(502, { error: "Couldn't read that site's brand." });
  }
}
