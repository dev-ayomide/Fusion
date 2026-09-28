import { useState } from "react";
import { useStore } from "../store";
import { fetchBrand, brandColourPlan, brandColourOps, brandLogoFile, type Brand } from "../brand";
import { importAsset } from "../../assets/assets";
import { createLayerOps } from "../create";
import { insertTime, revealLayer } from "../reveal";
import { colourName, Icon } from "./ui";

/** Paste a website, see its colours and logo, then use them. Shared by the editor and the landing page. */
export function BrandInput({ onBrand, placeholder = "Paste a website, e.g. stripe.com", compact }: { onBrand: (b: Brand) => void; placeholder?: string; compact?: boolean }) {
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!site.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onBrand(await fetchBrand(site));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`brand-in${compact ? " compact" : ""}`}>
      <div className="brand-in-row">
        <input
          value={site}
          onChange={(e) => setSite(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void go())}
          placeholder={placeholder}
          aria-label="Brand website"
          data-testid="brand-url"
        />
        <button className="btn sm" onClick={() => void go()} disabled={!site.trim() || busy} data-testid="brand-fetch">
          {busy ? "Reading…" : "Get brand"}
        </button>
      </div>
      {error && <div className="brand-err" role="alert">{error}</div>}
    </div>
  );
}

/** Logo + name + swatches for a fetched brand. */
export function BrandPreview({ brand, labels }: { brand: Brand; labels?: Record<string, string> }) {
  const byHex = Object.fromEntries(Object.entries(labels ?? {}).map(([k, v]) => [v, k]));
  const logo = brand.logos[0]?.url;
  return (
    <div className="brand-card" data-testid="brand-card">
      <div className="brand-card-head">
        {logo ? <img src={logo.startsWith("data:") ? logo : `/api/brand/image?url=${encodeURIComponent(logo)}`} alt="" /> : <span className="brand-card-noimg"><Icon name="image" sm /></span>}
        <b>{brand.name}</b>
      </div>
      <div className="brand-swatches">
        {brand.colors.map((c) => (
          <div key={c.hex} className="brand-sw" title={c.hex}>
            <span style={{ background: c.hex }} />
            <small>{byHex[c.hex] ? `→ ${colourName(byHex[c.hex])}` : c.hex}</small>
          </div>
        ))}
        {!brand.colors.length && <span className="faint" style={{ fontSize: 12 }}>No colours found on that page.</span>}
      </div>
    </div>
  );
}

/** Editor version (Colours & font): fetch, preview what each colour will replace, apply colours and/or the logo. */
export function BrandFetcher() {
  const doc = useStore((s) => s.doc);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = brand ? brandColourPlan(doc, brand) : {};

  const useColours = () => {
    if (!brand) return;
    const ops = brandColourOps(useStore.getState().doc, brand);
    if (!ops.length) return useStore.getState().toast("Those colours are already in use.");
    useStore.getState().commit(ops, { source: "you", intent: `${brand.name} colours` });
  };
  const addLogo = async () => {
    if (!brand) return;
    setBusy(true);
    try {
      const st = useStore.getState();
      const file = await brandLogoFile(brand, st.doc.brand.colors.ink);
      if (!file) return st.toast("Couldn't download that logo. You can still add one with Image.", "error");
      const { id: asset, entry } = await importAsset(file, Object.keys(st.doc.assets));
      const at = insertTime();
      const withAsset = { ...st.doc, assets: { ...st.doc.assets, [asset]: entry } };
      const { ops, id } = createLayerOps(withAsset, "image", at, { asset });
      const r = st.commit([{ op: "set", path: `assets/${asset}`, value: entry }, ...ops, { op: "set", path: `${id}/name`, value: `${brand.name} logo` }], { source: "you", intent: `Added ${brand.name} logo` });
      if (r.ok) {
        st.select([id]);
        revealLayer(id, at);
      } else st.toast(r.errors[0], "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brand-fetch" data-testid="brand-fetcher">
      <BrandInput onBrand={setBrand} />
      {brand && (
        <>
          <BrandPreview brand={brand} labels={plan} />
          <div className="brand-actions">
            <button className="btn sm primary" onClick={useColours} disabled={!Object.keys(plan).length} data-testid="brand-use-colours">Use these colours</button>
            <button className="btn sm" onClick={() => void addLogo()} disabled={!brand.logos.length || busy} data-testid="brand-add-logo">{busy ? "Adding…" : "Add logo"}</button>
          </div>
        </>
      )}
    </div>
  );
}
