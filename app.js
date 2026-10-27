(function () {
  var COLORS = [
    { id: "nes", label: "네스" }, { id: "lora", label: "로라" }, { id: "robin", label: "로빈" },
    { id: "etc", label: "기타" }, { id: "note", label: "정산 메모" }
  ];
  var DEFAULT_LABELS = {}; COLORS.forEach(function (c) { DEFAULT_LABELS[c.id] = c.label; });
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var POLL_MS = 5000;
  var $ = function (id) { return document.getElementById(id); };
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function key(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function nid() { return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function validColor(c) { return COLORS.some(function (x) { return x.id === c; }); }

  var cache = [];
  var now = new Date();
  var view = { y: now.getFullYear(), m: now.getMonth() };
  var sel = null, newColor = "nes", lastSig = "", lgEditing = false;
  var busy = 0, online = false;

  function api(path, opts) {
    opts = opts || {};
    opts.headers = { "content-type": "application/json" };
    opts.cache = "no-store";
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }
  function status(text, cls) { var s = $("status"); s.textContent = text; s.className = "status" + (cls ? " " + cls : ""); }
  function setReadyStatus() {
    if (online) status("공유 저장 사용 중 · 몇 초 안에 다른 사람의 변경이 보입니다", "on");
    else status("서버에 연결하지 못했습니다. 잠시 후 다시 시도합니다.", "err");
  }
  function applyLabels(o) {
    COLORS.forEach(function (c) {
      var v = o && typeof o[c.id] === "string" && o[c.id].trim() ? o[c.id].trim() : DEFAULT_LABELS[c.id];
      c.label = v;
    });
  }
  function currentLabels() { var o = {}; COLORS.forEach(function (c) { o[c.id] = c.label; }); return o; }
  function find(id) { for (var i = 0; i < cache.length; i++) if (cache[i].id === id) return cache[i]; return null; }

  /* ---------- 서버 통신 ---------- */
  function send(path, opts) {
    busy += 1;
    return api(path, opts).then(function () { online = true; }).catch(function () {
      status("저장하지 못했습니다. 연결을 확인해 주세요.", "err");
      online = false;
    }).then(function () { busy -= 1; });
  }
  function load() {
    if (busy > 0 || document.hidden) return Promise.resolve();
    return api("/api/state").then(function (s) {
      if (busy > 0) return;
      online = true;
      cache = (s.memos || []).map(function (m) {
        return { id: String(m.id), date: String(m.date), color: validColor(m.color) ? m.color : "etc", text: String(m.text || ""), ts: Number(m.ts) || 0 };
      });
      if (!lgEditing) { applyLabels(s.labels); renderLegend(); }
      setReadyStatus(); renderCal(); refreshSheet();
    }).catch(function () { online = false; setReadyStatus(); });
  }
  function pushMemo(m) {
    return send("/api/memo", { method: "POST", body: JSON.stringify({ id: m.id, date: m.date, color: m.color, text: m.text, ts: m.ts }) });
  }

  function opAdd(date, color, text) {
    var m = { id: nid(), date: date, color: color, text: text, ts: Date.now() };
    cache.push(m); renderCal(); refreshSheet(); pushMemo(m);
  }
  function opColor(id, color) {
    var m = find(id); if (!m) return;
    m.color = color; renderCal(); refreshSheet(); pushMemo(m);
  }
  var textTimers = {};
  function opText(id, text) {
    var m = find(id); if (!m) return;
    m.text = text; renderCal();
    busy += 1;
    clearTimeout(textTimers[id]);
    if (textTimers[id]) busy -= 1; // 이전 대기분 정리
    textTimers[id] = setTimeout(function () {
      textTimers[id] = null;
      busy -= 1;
      if (m.text.trim()) pushMemo(m);
    }, 450);
  }
  function opDelete(id) {
    if (textTimers[id]) { clearTimeout(textTimers[id]); textTimers[id] = null; busy -= 1; }
    cache = cache.filter(function (m) { return m.id !== id; });
    renderCal(); refreshSheet();
    send("/api/memo?id=" + encodeURIComponent(id), { method: "DELETE" });
  }
  var labelTimer = null;
  function opLabels() {
    if (labelTimer) clearTimeout(labelTimer); else busy += 1;
    labelTimer = setTimeout(function () {
      labelTimer = null; busy -= 1;
      send("/api/labels", { method: "POST", body: JSON.stringify(currentLabels()) });
    }, 450);
  }

  /* ---------- 화면 ---------- */
  function dayList(k) {
    return cache.filter(function (m) { return m.date === k; })
      .sort(function (a, b) { return a.ts - b.ts || (a.id < b.id ? -1 : 1); });
  }
  function renderLegend() {
    var box = $("legend"); box.innerHTML = "";
    COLORS.forEach(function (c) {
      var s = document.createElement("span");
      var sw = document.createElement("i"); sw.className = "sw " + (c.id === "note" ? "note" : "c-" + c.id);
      if (c.id === "note") sw.textContent = "가나";
      s.appendChild(sw);
      if (lgEditing) {
        var inp = document.createElement("input"); inp.type = "text"; inp.maxLength = 10; inp.value = c.label;
        inp.id = "lg-" + c.id; inp.setAttribute("aria-label", c.label + " 이름");
        inp.addEventListener("input", function () {
          if (inp.value.trim()) { c.label = inp.value.trim(); opLabels(); }
        });
        s.appendChild(inp);
      } else {
        s.appendChild(document.createTextNode(c.label));
      }
      box.appendChild(s);
    });
    $("lgEdit").textContent = lgEditing ? "완료" : "이름 편집";
  }

  function renderCal() {
    $("ttl").innerHTML = view.y + "년 <span class=\"m\">" + (view.m + 1) + "월</span>";
    var first = new Date(view.y, view.m, 1);
    var start = new Date(view.y, view.m, 1 - first.getDay());
    var weeks = Math.ceil((first.getDay() + new Date(view.y, view.m + 1, 0).getDate()) / 7);
    var todayKey = key(now.getFullYear(), now.getMonth(), now.getDate());
    var g = $("grid"); g.innerHTML = "";
    for (var i = 0; i < weeks * 7; i++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var k = key(dt.getFullYear(), dt.getMonth(), dt.getDate());
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cell d" + dt.getDay() + (dt.getMonth() !== view.m ? " out" : "") + (k === todayKey ? " today" : "");
      b.setAttribute("data-k", k);
      b.setAttribute("aria-label", (dt.getMonth() + 1) + "월 " + dt.getDate() + "일 메모");
      var n = document.createElement("span"); n.className = "num"; n.textContent = dt.getDate(); b.appendChild(n);
      var list = dayList(k);
      if (list.length) {
        var box = document.createElement("div"); box.className = "memos";
        list.forEach(function (mm) {
          var c = document.createElement("div"); c.className = "chip c-" + mm.color; c.textContent = mm.text; box.appendChild(c);
        });
        b.appendChild(box);
      }
      g.appendChild(b);
    }
  }

  function picks(container, current, onPick) {
    container.innerHTML = "";
    COLORS.forEach(function (c) {
      var p = document.createElement("button");
      p.type = "button"; p.className = "pick c-" + c.id; p.textContent = c.label;
      p.setAttribute("aria-pressed", current === c.id ? "true" : "false");
      p.addEventListener("click", function () { onPick(c.id); });
      container.appendChild(p);
    });
  }
  function sigOf(k) { return dayList(k).map(function (m) { return m.id + ":" + m.color; }).join("|") + "#" + COLORS.map(function (c) { return c.label; }).join(","); }

  function renderSheet() {
    var parts = sel.split("-").map(Number);
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    $("shT").textContent = parts[1] + "월 " + parts[2] + "일 (" + DOW[dt.getDay()] + ")";
    var rows = $("rows"); rows.innerHTML = "";
    var list = dayList(sel);
    lastSig = sigOf(sel);
    if (!list.length) {
      var e = document.createElement("p"); e.className = "empty"; e.textContent = "이 날짜에는 메모가 없습니다."; rows.appendChild(e);
    }
    list.forEach(function (mm) {
      var r = document.createElement("div"); r.className = "row";
      var line = document.createElement("div"); line.className = "line";
      var inp = document.createElement("input"); inp.type = "text"; inp.value = mm.text; inp.maxLength = 60;
      inp.setAttribute("aria-label", "메모 내용");
      inp.addEventListener("input", function () { opText(mm.id, inp.value); });
      var del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "삭제";
      del.addEventListener("click", function () { opDelete(mm.id); });
      line.appendChild(inp); line.appendChild(del);
      var pk = document.createElement("div"); pk.className = "picks";
      picks(pk, mm.color, function (cid) { opColor(mm.id, cid); });
      r.appendChild(line); r.appendChild(pk); rows.appendChild(r);
    });
    var onNew = function (cid) { newColor = cid; picks($("newPicks"), newColor, onNew); };
    picks($("newPicks"), newColor, onNew);
  }
  function refreshSheet() {
    if (!sel || $("ov").hidden) return;
    if (sigOf(sel) === lastSig) return;
    var a = document.activeElement;
    if (a && $("rows").contains(a) && a.tagName === "INPUT") return;
    renderSheet();
  }

  function addMemo() {
    var t = $("newText").value.trim();
    if (!t) { $("newText").focus(); return; }
    opAdd(sel, newColor, t);
    $("newText").value = ""; $("newText").focus();
  }
  function openSheet(k) { sel = k; renderSheet(); $("ov").hidden = false; $("newText").focus(); load(); }
  function closeSheet() { $("ov").hidden = true; sel = null; }

  $("grid").addEventListener("click", function (e) {
    var c = e.target.closest(".cell"); if (c) openSheet(c.getAttribute("data-k"));
  });
  $("prev").addEventListener("click", function () { view.m -= 1; if (view.m < 0) { view.m = 11; view.y -= 1; } renderCal(); });
  $("next").addEventListener("click", function () { view.m += 1; if (view.m > 11) { view.m = 0; view.y += 1; } renderCal(); });
  $("today").addEventListener("click", function () { view = { y: now.getFullYear(), m: now.getMonth() }; renderCal(); });
  $("lgEdit").addEventListener("click", function () { lgEditing = !lgEditing; renderLegend(); if (!lgEditing) { load(); if (sel) renderSheet(); } });
  $("close").addEventListener("click", closeSheet);
  $("ov").addEventListener("click", function (e) { if (e.target === $("ov")) closeSheet(); });
  $("addBtn").addEventListener("click", addMemo);
  $("newText").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addMemo(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("ov").hidden) closeSheet(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });

  renderLegend(); renderCal(); setReadyStatus();
  status("연결 중…", "");
  load();
  setInterval(load, POLL_MS);
})();
