/**
 * The dashboard's client-side script, inlined into dashboard.html as-is.
 *
 * Deliberately dumb: every decision (tier order, badge text, sanitized URLs,
 * duplicate notes, formatted times) is precomputed by the tested view-model —
 * this script only builds DOM from it. Feed-derived text goes through
 * `textContent` ONLY (never innerHTML): feeds are untrusted input.
 *
 * Kept free of backticks and `${` so it can live in an ordinary string and be
 * inlined without escaping surprises. Not unit-tested (tests run no browser);
 * exercised by the live run.
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  "use strict";

  var vm;
  try {
    vm = JSON.parse(document.getElementById("sitrep-data").textContent);
  } catch (e) {
    return showFallback("Could not read the embedded sitrep data.");
  }

  var TIER_COLOURS = { CRITICAL: "#ef4444", HIGH: "#f59e0b", MODERATE: "#eab308" };
  var STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
  var openPopup = null;
  var map = null;

  // --- tiny DOM helpers (textContent only for data — feeds are untrusted) ---
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Map failure (no WebGL, blocked CDN, bad payload) is announced with a
  // dismissible bottom banner — never a dead end: the events panel auto-opens
  // and carries the full brief (never fail silently).
  function showFallback(reason) {
    var banner = document.getElementById("fallback-banner");
    if (banner) {
      banner.hidden = false;
      var detail = document.getElementById("fallback-reason");
      if (detail && reason) {
        // Engine errors can be huge JSON blobs — keep the banner readable.
        var brief = String(reason);
        if (brief.length > 120) brief = brief.slice(0, 117) + "...";
        detail.textContent = "(" + brief + ")";
      }
    }
    openPanel();
  }

  function openPanel() {
    document.body.classList.add("panel-open");
  }

  function togglePanel() {
    document.body.classList.toggle("panel-open");
  }

  // --- detail card (shared by marker click and list click) ---
  function buildCard(ev) {
    var card = el("div", "card");
    var chips = el("div", "chips");
    chips.appendChild(el("span", "chip feed", ev.feed));
    chips.appendChild(el("span", "chip tier t-" + ev.tier, ev.tier));
    if (ev.isNew) chips.appendChild(el("span", "chip new", "NEW"));
    card.appendChild(chips);
    card.appendChild(el("h3", "card-title", ev.title));
    var meta = el("p", "card-meta", ev.location + " · " + ev.timeUtc);
    card.appendChild(meta);
    if (ev.changeNote) card.appendChild(el("p", "chg", "△ " + ev.changeNote));
    if (ev.badges.length) {
      var badges = el("div", "badges");
      ev.badges.forEach(function (b) {
        badges.appendChild(el("span", "badge", b));
      });
      card.appendChild(badges);
    }
    if (ev.duplicateNote) card.appendChild(el("p", "dup", "⚠ " + ev.duplicateNote));
    if (ev.assessment) card.appendChild(el("p", "assessment", ev.assessment));
    if (ev.sourceUrl) {
      var p = el("p", "src");
      var a = el("a", null, "source");
      a.href = ev.sourceUrl; // sanitized server-side: http(s) only
      a.rel = "noopener";
      a.target = "_blank";
      p.appendChild(a);
      card.appendChild(p);
    }
    return card;
  }

  function openCard(ev) {
    if (!map || !ev.coordinates) return;
    if (openPopup) openPopup.remove();
    openPopup = new maplibregl.Popup({ maxWidth: "340px", offset: 14 })
      .setLngLat([ev.coordinates.lon, ev.coordinates.lat])
      .setDOMContent(buildCard(ev))
      .addTo(map);
    // Clear the reference when the user closes the card (X / map click),
    // so we never hold a stale removed popup.
    openPopup.on("close", function () { openPopup = null; });
  }

  function flyToEvent(ev) {
    if (!map || !ev.coordinates) return;
    map.flyTo({ center: [ev.coordinates.lon, ev.coordinates.lat], zoom: 5 });
    openCard(ev);
  }

  // --- panel: meta line, degradation notices, tier groups ---
  document.getElementById("meta").textContent =
    "Generated " + vm.generatedUtc + " · feeds: " + vm.feedsLine +
    (vm.changesLine ? " · " + vm.changesLine : "");

  var badge = document.getElementById("count-badge");
  badge.textContent = String(vm.totalCount);

  var notices = document.getElementById("notices");
  if (vm.degradation.length) {
    document.getElementById("btn-status").hidden = false;
    vm.degradation.forEach(function (d) {
      notices.appendChild(
        el("p", "notice", d.feed + " feed unavailable this run — " + d.reason +
          ". Events from this feed are missing."),
      );
    });
  }

  // "Changes since yesterday" block: possibly-withdrawn notes (ADR 0009).
  var changes = document.getElementById("changes");
  if (vm.withdrawn.length) {
    changes.appendChild(el("h2", "changes-title", "Changes since yesterday"));
    vm.withdrawn.forEach(function (note) {
      changes.appendChild(el("p", "notice chg-notice", note));
    });
  }

  var groups = document.getElementById("groups");
  if (vm.totalCount === 0) {
    groups.appendChild(el("p", "quiet", "No surfaced events this run — a quiet morning."));
    openPanel();
  }
  vm.tiers.forEach(function (group) {
    // Native details/summary: each tier subsection toggles open/closed with
    // keyboard support for free. Default expanded.
    var section = el("details", "group");
    section.open = true;
    var h = el("summary", "group-title t-" + group.tier, group.tier + " (" + group.count + ")");
    section.appendChild(h);
    group.events.forEach(function (ev) {
      var row = el("div", "row" + (ev.coordinates ? "" : " no-coords"));
      var chips = el("div", "chips");
      chips.appendChild(el("span", "chip tier t-" + ev.tier, ev.tier));
      chips.appendChild(el("span", "chip feed", ev.feed));
      if (ev.isNew) chips.appendChild(el("span", "chip new", "NEW"));
      if (!ev.coordinates) chips.appendChild(el("span", "chip listonly", "list-only"));
      row.appendChild(chips);
      row.appendChild(el("div", "row-title", ev.title));
      row.appendChild(el("div", "row-meta", ev.location + " · " + ev.timeUtc));
      if (ev.changeNote) row.appendChild(el("div", "chg", "△ " + ev.changeNote));
      if (ev.coordinates) {
        row.addEventListener("click", function () { flyToEvent(ev); });
      }
      section.appendChild(row);
    });
    groups.appendChild(section);
  });

  // --- rail buttons + banner dismiss ---
  document.getElementById("btn-events").addEventListener("click", togglePanel);
  document.getElementById("btn-status").addEventListener("click", openPanel);
  document.getElementById("banner-close").addEventListener("click", function () {
    document.getElementById("fallback-banner").hidden = true;
  });

  // --- map ---
  var withCoords = [];
  vm.tiers.forEach(function (g) {
    g.events.forEach(function (ev) { if (ev.coordinates) withCoords.push(ev); });
  });

  try {
    if (typeof maplibregl === "undefined") throw new Error("map library failed to load");
    map = new maplibregl.Map({
      container: "map",
      style: STYLE_URL,
      center: [20, 12],
      zoom: 1.4,
    });
    map.addControl(new maplibregl.NavigationControl(), "bottom-left");

    withCoords.forEach(function (ev) {
      var dot = el("button", "mk t-" + ev.tier);
      dot.title = ev.title;
      dot.style.setProperty("--mk", TIER_COLOURS[ev.tier] || "#38bdf8");
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        openCard(ev);
      });
      new maplibregl.Marker({ element: dot })
        .setLngLat([ev.coordinates.lon, ev.coordinates.lat])
        .addTo(map);
    });

    // Position the view only once the style has loaded — calling fitBounds
    // synchronously after construction can be dropped on slow style loads,
    // leaving every marker off-screen.
    map.on("load", function () {
      if (withCoords.length === 1) {
        map.setCenter([withCoords[0].coordinates.lon, withCoords[0].coordinates.lat]);
        map.setZoom(4);
      } else if (withCoords.length > 1) {
        var b = new maplibregl.LngLatBounds();
        withCoords.forEach(function (ev) {
          b.extend([ev.coordinates.lon, ev.coordinates.lat]);
        });
        map.fitBounds(b, { padding: 80, maxZoom: 6 });
      }
    });
  } catch (e) {
    showFallback(String(e && e.message ? e.message : e));
  }
})();
`;
