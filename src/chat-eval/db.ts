import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  cmd         TEXT NOT NULL,
  suite_name  TEXT,
  notes       TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id            INTEGER PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  prompt_id     TEXT,
  prompt        TEXT NOT NULL,
  model         TEXT NOT NULL,
  origin_lat    REAL,
  origin_lon    REAL,
  started_at    TEXT NOT NULL,
  total_ms      INTEGER,
  tool_total_ms INTEGER,
  non_tool_ms   INTEGER,
  sdk_msg_count INTEGER,
  final_text    TEXT,
  usage_json    TEXT,
  error         TEXT,
  path_adds_json TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id          INTEGER PRIMARY KEY,
  turn_id     INTEGER NOT NULL REFERENCES turns(id),
  seq         INTEGER NOT NULL,
  tool        TEXT NOT NULL,
  args_json   TEXT NOT NULL,
  result_json TEXT,
  duration_ms INTEGER NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_turns_run ON turns(run_id);
CREATE INDEX IF NOT EXISTS idx_tools_turn ON tool_calls(turn_id);
`;

export interface RunRow {
  run_id: string; started_at: string; cmd: string;
  suite_name?: string | null; notes?: string | null;
}
export interface TurnRow {
  run_id: string; prompt_id: string | null; prompt: string; model: string;
  origin_lat: number | null; origin_lon: number | null;
  started_at: string;
  total_ms: number | null; tool_total_ms: number | null;
  non_tool_ms: number | null; sdk_msg_count: number | null;
  final_text: string | null; usage_json: string | null;
  error: string | null; path_adds_json: string | null;
}
export interface ToolCallRow {
  turn_id: number; seq: number; tool: string;
  args_json: string; result_json: string | null;
  duration_ms: number; ok: 0 | 1;
}

export interface EvalDb {
  raw: Database.Database;
  insertRun(r: RunRow): void;
  insertTurn(t: TurnRow): number;
  insertToolCall(c: ToolCallRow): void;
  close(): void;
}

export function openEvalDb(path: string): EvalDb {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);
  try {
    raw.exec(`ALTER TABLE turns ADD COLUMN path_adds_json TEXT`);
  } catch (e) {
    // ignore: column already exists from a previous run
    if (!/duplicate column/i.test((e as Error).message)) throw e;
  }

  const insRun = raw.prepare(
    `INSERT INTO runs (run_id, started_at, cmd, suite_name, notes)
     VALUES (@run_id, @started_at, @cmd, @suite_name, @notes)`,
  );
  const insTurn = raw.prepare(
    `INSERT INTO turns
      (run_id, prompt_id, prompt, model, origin_lat, origin_lon, started_at,
       total_ms, tool_total_ms, non_tool_ms, sdk_msg_count, final_text, usage_json, error, path_adds_json)
     VALUES
      (@run_id, @prompt_id, @prompt, @model, @origin_lat, @origin_lon, @started_at,
       @total_ms, @tool_total_ms, @non_tool_ms, @sdk_msg_count, @final_text, @usage_json, @error, @path_adds_json)`,
  );
  const insTool = raw.prepare(
    `INSERT INTO tool_calls
      (turn_id, seq, tool, args_json, result_json, duration_ms, ok)
     VALUES (@turn_id, @seq, @tool, @args_json, @result_json, @duration_ms, @ok)`,
  );

  return {
    raw,
    insertRun: (r) => { insRun.run({ suite_name: null, notes: null, ...r }); },
    insertTurn: (t) => Number(insTurn.run(t).lastInsertRowid),
    insertToolCall: (c) => { insTool.run(c); },
    close: () => raw.close(),
  };
}
