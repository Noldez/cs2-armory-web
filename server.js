const express = require("express");
const mysql = require("mysql2/promise");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

// Load .env if present
if (fs.existsSync(path.join(__dirname, ".env"))) {
  fs.readFileSync(path.join(__dirname, ".env"), "utf-8")
    .split("\n").forEach(line => {
      const [k, ...v] = line.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "armory",
  supportBigNumbers: true,
  bigNumberStrings: true,
  waitForConnections: true,
  connectionLimit: 5,
});

// Same DDL the Armory plugin runs on startup — whichever boots first creates the schema.
async function ensureTables() {
  const dbName = process.env.DB_NAME || "armory";
  const bootstrap = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });
  await bootstrap.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS weapon_skins (
        steam_id     BIGINT UNSIGNED   NOT NULL,
        item_def     INT               NOT NULL,
        paint_id     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        wear         FLOAT             NOT NULL DEFAULT 0.000001,
        seed         INT               NOT NULL DEFAULT 0,
        stattrak     INT               NULL,
        name_tag     VARCHAR(64)       NULL,
        stickers     JSON              NULL,
        keychain     JSON              NULL,
        custom_model VARCHAR(255)      NULL,
        PRIMARY KEY (steam_id, item_def)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS loadouts (
        steam_id BIGINT UNSIGNED NOT NULL,
        team     TINYINT         NOT NULL,
        slot     ENUM('knife','gloves','agent','music','medal') NOT NULL,
        item_def INT             NOT NULL,
        PRIMARY KEY (steam_id, team, slot)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS player_models (
        steam_id   BIGINT UNSIGNED NOT NULL,
        team       TINYINT         NOT NULL,
        model_path VARCHAR(255)    NOT NULL,
        PRIMARY KEY (steam_id, team)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS precache_models (
        model_path VARCHAR(255) NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✓ Tables ready");
  } finally {
    conn.release();
  }
}

// ─── Live sync to the game server ─────────────────────────────────────────────

const ARMORY_URL = process.env.ARMORY_URL || "http://127.0.0.1:27021";
const ARMORY_TOKEN = process.env.ARMORY_TOKEN || "";

async function armoryPost(route) {
  if (!ARMORY_TOKEN) return false;
  try {
    const res = await fetch(`${ARMORY_URL}${route}`, {
      method: "POST",
      headers: { "X-Armory-Token": ARMORY_TOKEN },
      timeout: 1500,
    });
    return res.ok;
  } catch {
    return false; // game server offline — change applies on next connect anyway
  }
}

const pushRefresh = steamId => armoryPost(`/refresh/${steamId}`);
const pushPrecacheReload = () => armoryPost("/precache/reload");

// ─── Catalog ──────────────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, "catalog.json");
let catalog = null;

const BYMYKEL  = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en";
const NEREZIEL = "https://raw.githubusercontent.com/Nereziel/cs2-WeaponPaints/main/website/data";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function loadCatalog() {
  if (fs.existsSync(CACHE_FILE)) {
    catalog = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    console.log("✓ Catalog loaded from cache");
    return;
  }
  console.log("Fetching skin catalog (first run, may take a moment)...");

  const [rawAll, rawAgents, rawMusic, rawStickers, rawKeychains] = await Promise.all([
    fetchJson(`${BYMYKEL}/skins.json`),
    fetchJson(`${NEREZIEL}/agents_en.json`),
    fetchJson(`${NEREZIEL}/music_en.json`),
    fetchJson(`${BYMYKEL}/stickers.json`),
    fetchJson(`${BYMYKEL}/keychains.json`),
  ]);

  const skins = [], gloves = [];
  for (const item of rawAll) {
    if (!item.weapon?.weapon_id || !item.paint_index) continue;
    if (item.category?.id === "sfui_invpanel_filter_gloves") {
      gloves.push({ weapon_defindex: item.weapon.weapon_id, paint: parseInt(item.paint_index), image: item.image ?? "", paint_name: item.name ?? "" });
    } else {
      skins.push({ weapon_defindex: item.weapon.weapon_id, weapon_name: item.weapon.name ?? "", paint: parseInt(item.paint_index), image: item.image ?? "", paint_name: item.name ?? "" });
    }
  }

  const stickers = rawStickers.filter(s => s.def_index != null).map(s => ({ id: String(s.def_index), name: s.name ?? "", image: s.image ?? "" }));
  const keychains = rawKeychains.filter(k => k.def_index != null).map(k => ({ id: String(k.def_index), name: k.name ?? "", image: k.image ?? "" }));

  const agents = rawAgents
    .map(a => {
      const match = a.image?.match(/agent-(\d+)\.png/);
      return match ? { ...a, id: parseInt(match[1]) } : null;
    })
    .filter(Boolean);

  catalog = { skins, gloves, agents, music: rawMusic, stickers, keychains };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(catalog));
  console.log(`✓ Catalog fetched: ${skins.length} skins, ${gloves.length} gloves, ${rawAgents.length} agents`);
}

// ─── API ──────────────────────────────────────────────────────────────────────

app.get("/api/catalog", (req, res) => {
  if (!catalog) return res.status(503).json({ error: "Catalog not ready" });
  res.json(catalog);
});

const CUSTOM_SKINS_FILE = path.join(__dirname, "custom_skins.json");

app.get("/api/custom-skins", (req, res) => {
  const skins = JSON.parse(fs.readFileSync(CUSTOM_SKINS_FILE, "utf-8"));
  res.json(skins);
});

const PLAYER_MODELS_CATALOG = [
  {
    id: "silver_wolf_player_model",
    name: "Silver Wolf",
    model_path: "characters/models/nozb1/silver_wolf_player_model/silver_wolf_player_model.vmdl",
    image: null,
    author: "nozb1"
  }
];

app.get("/api/player-models-catalog", (req, res) => res.json(PLAYER_MODELS_CATALOG));

// One round-trip for everything the UI needs
app.get("/api/loadout/:steamId", async (req, res) => {
  const { steamId } = req.params;
  try {
    const [skins] = await pool.execute(
      `SELECT item_def AS ItemId, paint_id AS PaintId, wear AS Wear, seed AS Seed,
              stattrak AS StatTrak, name_tag AS NameTag, custom_model AS ModelPath
       FROM weapon_skins WHERE steam_id = ?`, [steamId]);
    const [loadoutRows] = await pool.execute(
      "SELECT team AS Team, slot AS Slot, item_def AS ItemId FROM loadouts WHERE steam_id = ?", [steamId]);
    const [modelRows] = await pool.execute(
      "SELECT team AS Team, model_path AS ModelPath FROM player_models WHERE steam_id = ?", [steamId]);

    const bySlot = slot => loadoutRows.filter(r => r.Slot === slot);
    const playerModels = {};
    modelRows.forEach(r => { playerModels[r.Team] = r.ModelPath; });

    res.json({
      skins,
      knives: bySlot("knife"),
      gloves: bySlot("gloves"),
      agents: bySlot("agent"),
      music: bySlot("music"),
      customModels: skins.filter(s => s.ModelPath),
      playerModels,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Weapon skins ─────────────────────────────────────────────────────────────

app.post("/api/skin", async (req, res) => {
  const { steamId, defindex, paintId, wear, seed, nametag, stattrak } = req.body;
  try {
    await pool.execute(
      `INSERT INTO weapon_skins (steam_id, item_def, paint_id, wear, seed, stattrak, name_tag, custom_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE paint_id=VALUES(paint_id), wear=VALUES(wear), seed=VALUES(seed),
                               stattrak=VALUES(stattrak), name_tag=VALUES(name_tag), custom_model=NULL`,
      [steamId, defindex, paintId, wear, Math.round(seed) || 0, stattrak ? 0 : null, nametag || null]
    );
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/skin/:steamId/:defindex", async (req, res) => {
  const { steamId, defindex } = req.params;
  try {
    await pool.execute("DELETE FROM weapon_skins WHERE steam_id = ? AND item_def = ?", [steamId, defindex]);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Loadout slots (knife / gloves / agent / music) ───────────────────────────

async function upsertLoadout(steamId, teams, slot, defindex) {
  for (const team of teams) {
    await pool.execute(
      `INSERT INTO loadouts (steam_id, team, slot, item_def) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE item_def=VALUES(item_def)`,
      [steamId, team, slot, defindex]
    );
  }
}

app.post("/api/knife", async (req, res) => {
  const { steamId, defindex } = req.body;
  try {
    await upsertLoadout(steamId, [2, 3], "knife", defindex);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/knife/:steamId", async (req, res) => {
  try {
    await pool.execute("DELETE FROM loadouts WHERE steam_id = ? AND slot = 'knife'", [req.params.steamId]);
    await pushRefresh(req.params.steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/gloves", async (req, res) => {
  const { steamId, defindex } = req.body;
  try {
    await upsertLoadout(steamId, [2, 3], "gloves", defindex);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/gloves/:steamId", async (req, res) => {
  try {
    await pool.execute("DELETE FROM loadouts WHERE steam_id = ? AND slot = 'gloves'", [req.params.steamId]);
    await pushRefresh(req.params.steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/agent", async (req, res) => {
  const { steamId, defindex, team } = req.body;
  try {
    await upsertLoadout(steamId, [team], "agent", defindex);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/music", async (req, res) => {
  const { steamId, musicId } = req.body;
  try {
    await upsertLoadout(steamId, [2, 3], "music", musicId);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Custom weapon models ─────────────────────────────────────────────────────

app.post("/api/custom-model", async (req, res) => {
  const { steamId, defindex, modelPath } = req.body;
  try {
    await pool.execute(
      `INSERT INTO weapon_skins (steam_id, item_def, custom_model) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE custom_model=VALUES(custom_model)`,
      [steamId, defindex, modelPath]
    );
    await pushPrecacheReload();
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/custom-model/:steamId/:defindex", async (req, res) => {
  const { steamId, defindex } = req.params;
  try {
    await pool.execute("UPDATE weapon_skins SET custom_model = NULL WHERE steam_id = ? AND item_def = ?", [steamId, defindex]);
    // drop rows that carried nothing but the custom model
    await pool.execute(
      `DELETE FROM weapon_skins WHERE steam_id = ? AND item_def = ?
       AND paint_id = 0 AND stattrak IS NULL AND name_tag IS NULL AND custom_model IS NULL`,
      [steamId, defindex]);
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Player models (per team: 2 = T, 3 = CT) ──────────────────────────────────

app.post("/api/player-model", async (req, res) => {
  const { steamId, modelPath, team } = req.body; // team: 2, 3 or "both"
  const teams = team === "both" || team == null ? [2, 3] : [parseInt(team)];
  try {
    for (const t of teams) {
      await pool.execute(
        `INSERT INTO player_models (steam_id, team, model_path) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE model_path=VALUES(model_path)`,
        [steamId, t, modelPath]
      );
    }
    await pushPrecacheReload();
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/player-model/:steamId/:team", async (req, res) => {
  const { steamId, team } = req.params;
  try {
    if (team === "both") {
      await pool.execute("DELETE FROM player_models WHERE steam_id = ?", [steamId]);
    } else {
      await pool.execute("DELETE FROM player_models WHERE steam_id = ? AND team = ?", [steamId, team]);
    }
    await pushRefresh(steamId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = 3000;

Promise.all([ensureTables(), loadCatalog()])
  .then(() => {
    app.listen(PORT, () => console.log(`\n✓ Armory web running → http://localhost:${PORT}\n`));
  })
  .catch(err => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
