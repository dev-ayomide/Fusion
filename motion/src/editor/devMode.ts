/**
 * Developer tools (the JSON tab, pasting raw ops) stay out of the everyday interface. Open the editor
 * with `?dev=1` to show them; the choice lasts for the browser tab.
 */
export function devMode(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("dev");
    if (q === "1") sessionStorage.setItem("fusion-dev", "1");
    if (q === "0") sessionStorage.removeItem("fusion-dev");
    return sessionStorage.getItem("fusion-dev") === "1";
  } catch {
    return false;
  }
}
