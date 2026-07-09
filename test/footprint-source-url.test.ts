import { describe, it, expect } from "vitest";
import { isAllowedFootprintUrl } from "../src/footprints/source.js";

// The networked httpFootprintSource is not unit-tested (thin adapter, no network
// in tests), but its SSRF guard is a pure function and IS tested here.
describe("isAllowedFootprintUrl (SSRF guard)", () => {
  it("allows the real feed origins over https", () => {
    expect(isAllowedFootprintUrl("https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uw123.geojson")).toBe(true);
    expect(isAllowedFootprintUrl("https://earthquake.usgs.gov/pdl/products/x/download/cont_mmi.json")).toBe(true);
    expect(isAllowedFootprintUrl("https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1")).toBe(true);
    expect(isAllowedFootprintUrl("https://usgs.gov/")).toBe(true); // apex host
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedFootprintUrl("http://earthquake.usgs.gov/detail.geojson")).toBe(false);
    expect(isAllowedFootprintUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedFootprintUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects internal / metadata / arbitrary hosts (SSRF)", () => {
    expect(isAllowedFootprintUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedFootprintUrl("https://169.254.169.254/")).toBe(false);
    expect(isAllowedFootprintUrl("https://localhost/admin")).toBe(false);
    expect(isAllowedFootprintUrl("https://evil.com/x")).toBe(false);
  });

  it("is not fooled by suffix look-alikes", () => {
    expect(isAllowedFootprintUrl("https://usgs.gov.evil.com/")).toBe(false);
    expect(isAllowedFootprintUrl("https://notusgs.gov/")).toBe(false);
    expect(isAllowedFootprintUrl("https://gdacs.org.attacker.net/")).toBe(false);
  });

  it("rejects malformed / empty input without throwing", () => {
    expect(isAllowedFootprintUrl("")).toBe(false);
    expect(isAllowedFootprintUrl("not a url")).toBe(false);
  });
});
