// @ts-ignore
import cors from 'cors';
import express from 'express';
import path from 'path';
import responseTime from 'response-time';
import sqlite3 from 'better-sqlite3';
import * as util from './util';

const db = sqlite3(path.join(util.APP_ROOT, 'map.db'), {
  // @ts-ignore
  // verbose: console.log,
});
const router = express.Router()
router.use(cors({origin: [cors({origin: /objmap\.relicsofthepast\.dev$/})]}));
router.use(responseTime());

router.use(express.static(path.join(util.APP_ROOT, 'static')));

function getQueryParamStr(req: express.Request, name: string) {
  const param = req.query[name];
  if (param == null)
    return null;
  if (Array.isArray(param))
    return null;
  return param.toString();
}

function parseResult(result: any): { [key: string]: any } {
  if (!result)
    return {};

  result.data = JSON.parse(result.data);
  result.drop = JSON.parse(result.drop) || undefined;
  result.equip = JSON.parse(result.equip) || undefined;
  if (!result.equip || !result.equip.length)
    result.equip = undefined;
  result.messageid = result.messageid || undefined;
  result.scale = result.scale != null ? result.scale : undefined;
  result.sharp_weapon_judge_type = result.sharp_weapon_judge_type != null ? result.sharp_weapon_judge_type : undefined;
  result.hard_mode = result.hard_mode ? true : undefined;
  // Most objects do not have DisableRankUpForMasterMode set, so don't include it unless it is set.
  result.disable_rankup_for_hard_mode = result.disable_rankup_for_hard_mode ? true : undefined;
  result.pos = result.data.Translate.map((v: number) => Math.round(v * 100) / 100);
  result.korok_id = result.korok_id || undefined;
  result.korok_type = result.korok_type || undefined;
  return result;
}

const FIELDS = 'objid, map_type, map_name, map_static, hash_id, unit_config_name as name, `drop`, equip, data, messageid, scale, sharp_weapon_judge_type, hard_mode, disable_rankup_for_hard_mode, spawns_with_lotm, field_area, korok_id, korok_type, one_hit_mode';

// Returns object details for an object.
router.route('/obj/:objid').get((req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE objid = @objid LIMIT 1`);
  const result = parseResult(stmt.get({
    objid: parseInt(req.params.objid, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns object details for an object.
router.route('/obj/:map_type/:map_name/:hash_id').get((req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type
      AND map_name = @map_name
      AND hash_id = @hash_id LIMIT 1`);
  const result = parseResult(stmt.get({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: parseInt(req.params.hash_id, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns the placement generation group for an object.
router.route('/obj/:map_type/:map_name/:hash_id/gen_group').get((req, res) => {
  const result = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE gen_group =
       (SELECT gen_group FROM objs
          WHERE map_type = @map_type
            AND map_name = @map_name
            AND hash_id = @hash_id LIMIT 1)`)
    .all({
      map_type: req.params.map_type,
      map_name: req.params.map_name,
      hash_id: parseInt(req.params.hash_id, 0),
    }).map(parseResult);
  if (!result.length)
    return res.status(404).json([]);
  res.json(result);
});

// Returns minimal object data for all matching objects.
function handleReqObjs(req: express.Request, res: express.Response) {
  const mapType: string | undefined = req.params.map_type;
  const mapName: string | undefined = req.params.map_name;
  const withMapNames: boolean = !!req.query.withMapNames;
  const q: string | null = getQueryParamStr(req, "q");
  const limitStr = getQueryParamStr(req, "limit");
  const limit: number = limitStr != null ? parseInt(limitStr, 10) : -1;
  if (!q) {
    res.json([]);
    return;
  }

  const getData = (x: any) => {
    x.data = undefined;
    if (!withMapNames)
      x.map_name = undefined;
    return x;
  };

  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const limitQuery = limit != -1 ? 'LIMIT @limit' : '';
  const query = `SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))
    ${limitQuery}`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
    limit,
  }).map(parseResult).map(getData));
}

router.route('/objs/:map_type').get(handleReqObjs);
router.route('/objs/:map_type/:map_name').get(handleReqObjs);

// Returns object IDs for all matching objects.
function handleReqObjids(req: express.Request, res: express.Response) {
  const mapType: string | undefined = req.params.map_type;
  const mapName: string | undefined = req.params.map_name;
  const q: string | null = getQueryParamStr(req, "q");
  if (!q) {
    res.json([]);
    return;
  }

  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const query = `SELECT objid FROM objs
    WHERE map_type = @map_type ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
  }).map(x => x.objid));
}

router.route('/objids/:map_type').get(handleReqObjids);
router.route('/objids/:map_type/:map_name').get(handleReqObjids);

function handleReqDropTable(req: express.Request, res: express.Response) {
  const actorName: string | undefined = req.params.actor_name; // Matches unit_config_name in table objs
  const tableName: string | undefined = req.params.table_name;
  let rows = [];
  if (actorName) {
    if (tableName) {
      // Replace NormalArrow with Normal
      let dropTableName = (tableName == "NormalArrow") ? "Normal" : tableName;
      // Drop tables selected if drop_table.name starts with tableName prefix
      const stmt = db.prepare(`SELECT data, name from drop_table where
           actor_name = ? and name like ? `);
      rows = stmt.all(actorName, `${dropTableName}%`);
    } else {
      // Get all Drop Tables for unitConfigName
      const stmt = db.prepare(`SELECT data, name from drop_table where
        actor_name = ? `);
      rows = stmt.all(actorName);
    }
    rows = rows.reduce((acc, cur) => ({ ...acc, [cur.name]: JSON.parse(cur.data) }), {});
  }
  res.json(rows);
}

router.route('/drop/:actor_name/:table_name').get(handleReqDropTable);
router.route('/drop/:actor_name').get(handleReqDropTable);

module.exports = router
