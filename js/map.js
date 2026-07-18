/* ==========================================================================
   Junakartta – karttasivu
   Leaflet-kartta, liikkuvat junamerkit, haku, seuranta ja paikannus.
   ========================================================================== */

(() => {
  const POLL_LOCATIONS_MS = 5000;
  const POLL_DETAILS_MS = 60000;

  /* ---------- Kartta ja tasot ---------- */

  const map = L.map("map", {
    center: [64.7, 26.2],
    zoom: 6,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

  // Karttapohjat: "Selkeä" näyttää paikkakunnat ja tiet selvästi, "Tumma" on
  // hillitty yökartta. Valinta muistetaan selaimessa.
  const baseLayers = {
    "Selkeä": L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: CARTO_ATTR, subdomains: "abcd", maxZoom: 19,
    }),
    "Tumma": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: CARTO_ATTR, subdomains: "abcd", maxZoom: 19,
    }),
  };

  const BASEMAP_STORE = "junakartta-pohja";
  let savedBase;
  try { savedBase = localStorage.getItem(BASEMAP_STORE); } catch (e) { /* yksityistila */ }
  const initialBase = baseLayers[savedBase] ? savedBase : "Selkeä";
  baseLayers[initialBase].addTo(map);

  function applyBaseBg(name) {
    map.getContainer().style.background = name === "Tumma" ? "#0a0d12" : "#d7dce0";
  }
  applyBaseBg(initialBase);

  map.on("baselayerchange", (e) => {
    applyBaseBg(e.name);
    try { localStorage.setItem(BASEMAP_STORE, e.name); } catch (err) { /* yksityistila */ }
  });

  L.control.layers(baseLayers, null, { position: "bottomright" }).addTo(map);

  map.attributionControl.addAttribution('Junatiedot: <a href="https://www.digitraffic.fi/rautatieliikenne/">Fintraffic / digitraffic.fi</a> (CC BY 4.0)');

  // Rautatieverkko OpenRailwayMapin tasona.
  const railLayer = L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
    attribution: 'Rataverkko: <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA)',
    subdomains: "abc",
    maxZoom: 19,
    opacity: 0.55,
  }).addTo(map);

  function updateLabelVisibility() {
    const el = map.getContainer();
    el.classList.toggle("labels-hidden", map.getZoom() < 7);
  }
  map.on("zoomend", updateLabelVisibility);
  updateLabelVisibility();

  /* ---------- Tila ---------- */

  const markers = new Map();      // key -> {marker, from, to, start, dur, bearing, miss, cat, label}
  const details = new Map();      // key -> junan aikataulutiedot (GraphQL)
  const detailsByNumber = new Map();
  let followKey = null;
  let lastPositions = [];
  let pendingFollowNumber = new URLSearchParams(location.search).get("juna");
  let filterCat = "kaikki";

  const statusChip = document.getElementById("status-chip");
  const statusText = document.getElementById("status-text");
  const followChip = document.getElementById("follow-chip");
  const followText = document.getElementById("follow-text");

  function detailsFor(key, trainNumber) {
    return details.get(key) || detailsByNumber.get(String(trainNumber)) || null;
  }

  /* ---------- Junamerkit ---------- */

  const ARROW_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.5 19 20l-7-4.2L5 20Z"/></svg>';

  function makeIcon(label, cat, moving) {
    return L.divIcon({
      className: "train-marker cat-" + cat,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html:
        '<div class="dot">' + (moving ? ARROW_SVG : '<div class="stopped"></div>') + "</div>" +
        '<div class="lbl">' + label + "</div>",
    });
  }

  function bearingBetween(a, b) {
    const toRad = Math.PI / 180;
    const dLon = (b.lng - a.lng) * toRad;
    const y = Math.sin(dLon) * Math.cos(b.lat * toRad);
    const x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
      Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  function labelFor(key, pos) {
    const d = detailsFor(key, pos.trainNumber);
    return d ? API.shortTitle(d) : String(pos.trainNumber);
  }

  function catFor(key, pos) {
    const d = detailsFor(key, pos.trainNumber);
    return d ? API.categoryOf(d) : "muu";
  }

  /* ---------- Junatyyppisuodatin ---------- */

  function matchesFilter(cat) {
    return filterCat === "kaikki" || cat === filterCat;
  }

  function setMarkerVisible(entry, visible) {
    const onMap = map.hasLayer(entry.marker);
    if (visible && !onMap) {
      entry.marker.addTo(map);
      applyMarkerDom(entry);
    } else if (!visible && onMap) {
      map.removeLayer(entry.marker);
    }
  }

  function setFilter(cat) {
    filterCat = cat;
    document.querySelectorAll("#map-filter .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.cat === cat));
    for (const entry of markers.values()) {
      setMarkerVisible(entry, matchesFilter(entry.cat));
    }
    if (followKey) {
      const entry = markers.get(followKey);
      if (entry && !matchesFilter(entry.cat)) stopFollow();
    }
    updateStatusCount();
  }

  document.querySelectorAll("#map-filter .chip").forEach((chip) => {
    chip.addEventListener("click", () => setFilter(chip.dataset.cat));
  });

  function applyMarkerDom(entry) {
    const el = entry.marker.getElement();
    if (!el) return;
    el.className = el.className.replace(/cat-\w+/g, "") + " cat-" + entry.cat;
    if (entry.key === followKey) el.classList.add("followed");
    else el.classList.remove("followed");
    const dot = el.querySelector(".dot");
    if (dot) dot.style.transform = "rotate(" + Math.round(entry.bearing) + "deg)";
    const lbl = el.querySelector(".lbl");
    if (lbl && lbl.textContent !== entry.label) lbl.textContent = entry.label;
  }

  function upsertMarkers(positions) {
    const seen = new Set();
    const now = performance.now();

    for (const pos of positions) {
      if (!pos.location || !pos.location.coordinates) continue;
      const key = pos.departureDate + ":" + pos.trainNumber;
      seen.add(key);
      const latlng = L.latLng(pos.location.coordinates[1], pos.location.coordinates[0]);
      const label = labelFor(key, pos);
      const cat = catFor(key, pos);
      const moving = (pos.speed || 0) > 3;
      let entry = markers.get(key);

      if (!entry) {
        const marker = L.marker(latlng, { icon: makeIcon(label, cat, moving), keyboard: false });
        entry = { key, marker, from: latlng, to: latlng, start: now, dur: 0, bearing: 0, miss: 0, cat, label, moving, pos };
        markers.set(key, entry);
        marker.on("click", () => openPopup(entry));
        if (matchesFilter(cat)) marker.addTo(map);
      } else {
        const cur = entry.marker.getLatLng();
        entry.from = cur;
        entry.to = latlng;
        entry.start = now;
        entry.dur = POLL_LOCATIONS_MS;
        if (cur.distanceTo(latlng) > 15) {
          entry.bearing = bearingBetween(cur, latlng);
        }
        entry.miss = 0;
        entry.pos = pos;
        if (entry.label !== label || entry.cat !== cat || entry.moving !== moving) {
          entry.label = label;
          entry.cat = cat;
          entry.moving = moving;
          entry.marker.setIcon(makeIcon(label, cat, moving));
        }
        setMarkerVisible(entry, matchesFilter(entry.cat));
      }
      applyMarkerDom(entry);
    }

    // Poistetaan junat, joita ei ole näkynyt kolmeen päivitykseen.
    for (const [key, entry] of markers) {
      if (!seen.has(key)) {
        entry.miss++;
        if (entry.miss >= 3) {
          map.removeLayer(entry.marker);
          markers.delete(key);
          if (followKey === key) stopFollow();
        }
      }
    }
  }

  // Sulava liike: interpoloidaan sijainnit ruudunpäivityksissä.
  function animate() {
    const now = performance.now();
    for (const entry of markers.values()) {
      if (entry.dur > 0) {
        const t = Math.min((now - entry.start) / entry.dur, 1);
        const lat = entry.from.lat + (entry.to.lat - entry.from.lat) * t;
        const lng = entry.from.lng + (entry.to.lng - entry.from.lng) * t;
        entry.marker.setLatLng([lat, lng]);
        if (t >= 1) entry.dur = 0;
      }
    }
    if (followKey) {
      const entry = markers.get(followKey);
      if (entry) map.panTo(entry.marker.getLatLng(), { animate: false });
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  /* ---------- Ponnahdusikkuna ---------- */

  function popupHtml(entry) {
    const d = detailsFor(entry.key, entry.pos.trainNumber);
    const speed = Math.round(entry.pos.speed || 0);
    let html = "";
    if (d) {
      const r = API.route(d);
      const badge = API.delayBadge(d);
      const next = API.nextStop(d);
      html += '<div class="tp-title">' + API.longTitle(d) + "</div>";
      html += '<div class="tp-route">' + r.from + " → " + r.to + "</div>";
      html += '<dl class="tp-grid">';
      html += "<dt>Tilanne</dt><dd><span class=\"badge " + badge.cls + '">' + badge.text + "</span></dd>";
      html += "<dt>Nopeus</dt><dd>" + speed + " km/h</dd>";
      if (next) html += "<dt>Seuraava</dt><dd>" + next.name + " klo " + API.fmtTime(next.time) + "</dd>";
      if (d.operator) html += "<dt>Operaattori</dt><dd>" + (d.operator.shortCode || "").toUpperCase() + "</dd>";
      html += "<dt>Tyyppi</dt><dd>" + API.CATEGORY_LABELS[API.categoryOf(d)] + "</dd>";
      html += "</dl>";
    } else {
      html += '<div class="tp-title">Juna ' + entry.pos.trainNumber + "</div>";
      html += '<dl class="tp-grid"><dt>Nopeus</dt><dd>' + speed + " km/h</dd></dl>";
    }
    const followed = followKey === entry.key;
    html += '<button class="tp-follow" data-key="' + entry.key + '">' +
      (followed ? "Lopeta seuranta" : "Seuraa junaa") + "</button>";
    return html;
  }

  function openPopup(entry) {
    const popup = L.popup({ offset: [0, -14], maxWidth: 280 })
      .setLatLng(entry.marker.getLatLng())
      .setContent(popupHtml(entry));
    popup.openOn(map);
    setTimeout(() => {
      const btn = document.querySelector(".tp-follow[data-key]");
      if (btn) {
        btn.addEventListener("click", () => {
          if (followKey === entry.key) stopFollow();
          else startFollow(entry.key);
          map.closePopup();
        });
      }
    }, 0);
  }

  /* ---------- Seuranta ---------- */

  function startFollow(key) {
    stopFollow();
    followKey = key;
    const entry = markers.get(key);
    if (entry) {
      // Haettu juna näkyviin, vaikka suodatin piilottaisi sen.
      if (!matchesFilter(entry.cat)) setFilter("kaikki");
      if (map.getZoom() < 10) map.setView(entry.marker.getLatLng(), 10);
      else map.panTo(entry.marker.getLatLng());
      applyMarkerDom(entry);
      const d = detailsFor(key, entry.pos.trainNumber);
      followText.textContent = "Seurataan: " + (d ? API.longTitle(d) : "juna " + entry.pos.trainNumber);
    }
    followChip.classList.add("on");
  }

  function stopFollow() {
    if (!followKey) return;
    const entry = markers.get(followKey);
    followKey = null;
    if (entry) applyMarkerDom(entry);
    followChip.classList.remove("on");
  }

  document.getElementById("follow-stop").addEventListener("click", stopFollow);
  map.on("dragstart", stopFollow);

  /* ---------- Haku ---------- */

  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  function searchIndex() {
    const items = [];
    for (const [key, entry] of markers) {
      const d = detailsFor(key, entry.pos.trainNumber);
      const r = d ? API.route(d) : null;
      items.push({
        key,
        number: String(entry.pos.trainNumber),
        title: d ? API.longTitle(d) : "Juna " + entry.pos.trainNumber,
        line: d && d.commuterLineid ? d.commuterLineid : "",
        routeText: r ? r.from + " → " + r.to : "",
        speed: Math.round(entry.pos.speed || 0),
        cat: entry.cat,
      });
    }
    return items;
  }

  function renderSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchResults.classList.remove("open");
      searchResults.innerHTML = "";
      return;
    }
    const hits = searchIndex().filter((it) =>
      it.number.startsWith(q) ||
      it.title.toLowerCase().includes(q) ||
      it.line.toLowerCase() === q ||
      it.routeText.toLowerCase().includes(q)
    ).slice(0, 12);

    searchResults.innerHTML = hits.length
      ? hits.map((it) =>
          '<div class="search-item" data-key="' + it.key + '">' +
          '<span class="cat-dot ' + it.cat + '"></span>' +
          '<div><div class="t">' + it.title + '</div><div class="r">' + (it.routeText || "&nbsp;") + "</div></div>" +
          '<span class="spd">' + it.speed + " km/h</span></div>"
        ).join("")
      : '<div class="search-empty">Ei osumia kulussa olevista junista.</div>';
    searchResults.classList.add("open");

    searchResults.querySelectorAll(".search-item").forEach((el) => {
      el.addEventListener("click", () => {
        startFollow(el.dataset.key);
        searchInput.value = "";
        renderSearch();
      });
    });
  }

  searchInput.addEventListener("input", renderSearch);
  searchInput.addEventListener("focus", renderSearch);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-panel")) searchResults.classList.remove("open");
  });

  /* ---------- Paikannus ---------- */

  let geoWatch = null;
  let geoLayers = null;

  const LocateControl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const btn = L.DomUtil.create("a", "map-btn", div);
      btn.id = "locate-btn";
      btn.href = "#";
      btn.title = "Näytä oma sijainti";
      btn.setAttribute("aria-label", "Näytä oma sijainti");
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-1.07A8 8 0 0 0 13 4.07V3a1 1 0 1 0-2 0v1.07A8 8 0 0 0 4.07 11H3a1 1 0 1 0 0 2h1.07A8 8 0 0 0 11 19.93V21a1 1 0 1 0 2 0v-1.07A8 8 0 0 0 19.93 13H21a1 1 0 1 0 0-2Zm-9 7a6 6 0 1 1 0-12 6 6 0 0 1 0 12Z"/></svg>';
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        toggleLocate(btn);
      });
      return div;
    },
  });
  map.addControl(new LocateControl());

  function toggleLocate(btn) {
    if (geoWatch != null) {
      navigator.geolocation.clearWatch(geoWatch);
      geoWatch = null;
      if (geoLayers) { map.removeLayer(geoLayers); geoLayers = null; }
      btn.classList.remove("active");
      return;
    }
    if (!navigator.geolocation) {
      alert("Selain ei tue paikannusta.");
      return;
    }
    btn.classList.add("active");
    let first = true;
    geoWatch = navigator.geolocation.watchPosition(
      (p) => {
        const ll = [p.coords.latitude, p.coords.longitude];
        if (!geoLayers) {
          geoLayers = L.layerGroup([
            L.circle(ll, { radius: p.coords.accuracy, color: "#4da3ff", weight: 1, fillOpacity: 0.12 }),
            L.marker(ll, {
              icon: L.divIcon({ className: "user-loc-dot", iconSize: [16, 16], iconAnchor: [8, 8] }),
              keyboard: false,
            }),
          ]).addTo(map);
        } else {
          const layers = geoLayers.getLayers();
          layers[0].setLatLng(ll).setRadius(p.coords.accuracy);
          layers[1].setLatLng(ll);
        }
        if (first) {
          first = false;
          stopFollow();
          map.setView(ll, Math.max(map.getZoom(), 12));
        }
      },
      () => {
        alert("Sijaintia ei saatu. Tarkista selaimen paikannuslupa.");
        btn.classList.remove("active");
        navigator.geolocation.clearWatch(geoWatch);
        geoWatch = null;
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }

  /* ---------- Rataverkkotason kytkin ---------- */

  const RailToggle = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const btn = L.DomUtil.create("a", "map-btn active", div);
      btn.href = "#";
      btn.title = "Rataverkko päälle/pois";
      btn.setAttribute("aria-label", "Rataverkko päälle/pois");
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 2a1 1 0 0 0-1 1v1H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h.28l-1.17 1.4a1 1 0 1 0 1.54 1.28L9.87 20h4.26l2.22 2.68a1 1 0 0 0 1.54-1.28L16.72 20H17a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-1V3a1 1 0 0 0-1-1H9Zm-3 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4H6V7Zm2 8.5A1.5 1.5 0 1 1 8 12.5a1.5 1.5 0 0 1 0 3Zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        if (map.hasLayer(railLayer)) {
          map.removeLayer(railLayer);
          btn.classList.remove("active");
        } else {
          railLayer.addTo(map);
          btn.classList.add("active");
        }
      });
      return div;
    },
  });
  map.addControl(new RailToggle());

  /* ---------- Tiedonhaku ---------- */

  function setStatus(ok, text) {
    statusChip.classList.toggle("error", !ok);
    statusText.innerHTML = text;
  }

  let lastUpdateClock = "";

  function updateStatusCount() {
    if (!lastUpdateClock) return;
    if (filterCat === "kaikki") {
      setStatus(true, "<b>" + lastPositions.length + "</b>&nbsp;junaa kulussa &middot; " + lastUpdateClock);
    } else {
      let visible = 0;
      for (const e of markers.values()) if (map.hasLayer(e.marker)) visible++;
      setStatus(true, "<b>" + visible + "</b>&nbsp;/ " + lastPositions.length + " junaa &middot; " + lastUpdateClock);
    }
  }

  async function pollLocations() {
    try {
      const positions = await API.getTrainLocations();
      lastPositions = positions;
      upsertMarkers(positions);
      lastUpdateClock = API.fmtClock();
      updateStatusCount();
      if (pendingFollowNumber) {
        const hit = [...markers.values()].find((m) => String(m.pos.trainNumber) === String(pendingFollowNumber));
        if (hit) {
          startFollow(hit.key);
          pendingFollowNumber = null;
        }
      }
    } catch (err) {
      console.error("Sijaintien haku epäonnistui:", err);
      setStatus(false, "Yhteysvirhe &ndash; yritetään uudelleen&hellip;");
    }
  }

  async function pollDetails() {
    try {
      const trains = await API.getRunningTrains();
      details.clear();
      detailsByNumber.clear();
      for (const t of trains) {
        details.set(API.trainKey(t), t);
        detailsByNumber.set(String(t.trainNumber), t);
      }
      // Päivitetään merkkien kategoriat/nimet uusilla tiedoilla.
      upsertMarkers(lastPositions);
    } catch (err) {
      console.error("Junatietojen haku epäonnistui:", err);
    }
  }

  pollDetails().then(pollLocations);
  setInterval(pollLocations, POLL_LOCATIONS_MS);
  setInterval(pollDetails, POLL_DETAILS_MS);
})();
