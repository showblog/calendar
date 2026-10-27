// Cloudflare Pages Functions + D1 — 일정 메모 달력 API
// 바인딩 이름: DB (D1 데이터베이스)

const COLORS = ["nes", "lora", "robin", "etc", "note"];
const SEED = [
  ["2026-10-16", "nes", "네스 휴가"], ["2026-10-16", "robin", "로빈 오전부재"], ["2026-10-16", "robin", "로빈 오후재택"],
  ["2026-10-19", "nes", "네스 휴가"], ["2026-10-21", "lora", "로라 휴가"],
  ["2026-10-23", "robin", "로빈 부재"], ["2026-10-23", "note", "반스팀버-1차정산"],
  ["2026-10-26", "note", "노스페이스정산"], ["2026-10-28", "nes", "네스 대체휴가"],
  ["2026-10-29", "lora", "로라 반반차"], ["2026-10-29", "note", "반스팀버-2차정산"],
  ["2026-10-30", "nes", "네스 오후반차"], ["2026-10-31", "note", "반스팀버 최종정산"]
];

let ready = null;
function ensure(db) {
  if (!ready) {
    ready = (async () => {
      await db.batch([
        db.prepare("CREATE TABLE IF NOT EXISTS memos (id TEXT PRIMARY KEY, date TEXT NOT NULL, color TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)"),
        db.prepare("CREATE TABLE IF NOT EXISTS labels (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
      ]);
      const done = await db.prepare("SELECT v FROM labels WHERE k = '_seeded'").first();
      if (!done) {
        const base = Date.now();
        const stmts = SEED.map((s, i) =>
          db.prepare("INSERT OR IGNORE INTO memos (id, date, color, text, ts) VALUES (?, ?, ?, ?, ?)")
            .bind("seed" + i, s[0], s[1], s[2], base + i));
        stmts.push(db.prepare("INSERT OR IGNORE INTO labels (k, v) VALUES ('_seeded', '1')"));
        await db.batch(stmts);
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: "D1 바인딩(DB)이 설정되지 않았습니다." }, 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  try {
    await ensure(env.DB);

    if (path === "/api/state" && method === "GET") {
      const m = await env.DB.prepare("SELECT id, date, color, text, ts FROM memos ORDER BY ts, id").all();
      const l = await env.DB.prepare("SELECT k, v FROM labels WHERE k NOT LIKE '\\_%' ESCAPE '\\'").all();
      const labels = {};
      (l.results || []).forEach((r) => { labels[r.k] = r.v; });
      return json({ memos: m.results || [], labels });
    }

    if (path === "/api/memo" && method === "POST") {
      const b = await request.json();
      const id = String(b.id || "");
      const date = String(b.date || "");
      const color = String(b.color || "");
      const text = String(b.text || "").trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          COLORS.indexOf(color) < 0 || text.length < 1 || text.length > 60) {
        return json({ error: "잘못된 요청입니다." }, 400);
      }
      const ts = Number.isFinite(Number(b.ts)) ? Math.floor(Number(b.ts)) : Date.now();
      await env.DB.prepare(
        "INSERT INTO memos (id, date, color, text, ts) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET date = excluded.date, color = excluded.color, text = excluded.text"
      ).bind(id, date, color, text, ts).run();
      return json({ ok: true });
    }

    if (path === "/api/memo" && method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return json({ error: "잘못된 요청입니다." }, 400);
      await env.DB.prepare("DELETE FROM memos WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (path === "/api/labels" && method === "POST") {
      const b = await request.json();
      const stmts = [];
      COLORS.forEach((c) => {
        const v = typeof b[c] === "string" ? b[c].trim() : "";
        if (v && v.length <= 10) {
          stmts.push(env.DB.prepare("INSERT INTO labels (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(c, v));
        }
      });
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true });
    }

    return json({ error: "찾을 수 없습니다." }, 404);
  } catch (e) {
    return json({ error: "서버 오류", detail: String(e && e.message || e) }, 500);
  }
}
