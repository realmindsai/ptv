// src/commands/chat-eval.ts
import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openEvalDb, type EvalDb } from '../chat-eval/db';
import { parseSuite } from '../chat-eval/suite';
import { runOne } from '../chat-eval/runner';
import { fetchConversationEvents, reconstructFromEvents } from '../chat-eval/replay';
import { renderTerminal } from '../chat-eval/renderers/terminal';
import { renderJsonl, type JsonlTurn } from '../chat-eval/renderers/jsonl';
import { renderHtml } from '../chat-eval/renderers/html';
import { runTurn } from '../chat/agent';
import type { SseEvent } from '../chat/types';
import { Nominatim } from '../server/nominatim';
import { Photon } from '../server/photon';
import { plan as planOrchestrator } from '../plan/orchestrator';
import { ghRouteBike, ghRouteCustom } from '../plan/external';
import { DAY_RIDE_CUSTOM_MODEL, MAX_PATH_CUSTOM_MODEL } from '../plan/types';
import { ptv } from '../client';
import { makeGeocodeTool } from '../chat/tools/geocode';
import { makePlanTool } from '../chat/tools/plan';
import { makeBikeRouteTool } from '../chat/tools/bike_route';
import { makeSearchStopsTool, makeNearbyStopsTool } from '../chat/tools/stops';
import { makeScheduleTool } from '../chat/tools/schedule';
import type { ChatCtx } from '../chat/types';

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

function parseCoord(s: string | undefined): { lat: number; lon: number } | null {
  if (!s) return null;
  const [a, b] = s.split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`bad --origin: ${s}`);
  return { lat: a, lon: b };
}

function buildTools(ctx: ChatCtx) {
  const nominatim = new Nominatim(process.env.NOMINATIM_URL ?? 'http://localhost:8094');
  const photon = process.env.PHOTON_URL ? new Photon(process.env.PHOTON_URL) : undefined;
  const bikeFn = async (from: any, to: any, goal: any) => {
    if (goal === 'day-ride') return ghRouteCustom(from, to, DAY_RIDE_CUSTOM_MODEL);
    if (goal === 'max-path') return ghRouteCustom(from, to, MAX_PATH_CUSTOM_MODEL);
    return ghRouteBike(from, to, 'bike');
  };
  return {
    geocode:      makeGeocodeTool(ctx, nominatim, photon),
    plan:         makePlanTool(ctx, planOrchestrator),
    bike_route:   makeBikeRouteTool(ctx, bikeFn),
    search_stops: makeSearchStopsTool(ptv),
    nearby_stops: makeNearbyStopsTool(ptv),
    schedule:     makeScheduleTool(),
  };
}

async function* sseGen(prompt: string, model: string, origin: any, history: any) {
  const messages = [
    ...(history ?? []),
    { role: 'user' as const, content: prompt },
  ];
  const tools = buildTools({ emit: () => {}, origin: origin ?? undefined });
  yield* runTurn({ messages, origin: origin ?? undefined, model } as any, { tools, model } as any);
}

interface RunGroupInput {
  db: EvalDb;
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  models: string[];
  origin: { lat: number; lon: number } | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function runPromptAcrossModels(input: RunGroupInput) {
  const results = await Promise.all(input.models.map(async (model) => {
    return runOne(
      {
        db: input.db,
        runTurn: async ({ prompt, model: m, origin, history }) => sseGen(prompt, m, origin, history) as unknown as AsyncGenerator<SseEvent>,
      },
      {
        run_id: input.run_id,
        prompt_id: input.prompt_id,
        prompt: input.prompt,
        model,
        origin: input.origin,
        history: input.history,
      },
    );
  }));
  return results;
}

export function chatEvalCommand(): Command {
  const cmd = new Command('chat-eval').description('Run the chat agent in batch / comparison / replay modes');

  cmd
    .command('run <prompt>')
    .description('Run a single prompt against one or more models')
    .option('--models <list>', 'comma-separated OpenRouter slugs (default: $MODEL)', (v) => v.split(',').map((s) => s.trim()))
    .option('--origin <lat,lon>', 'geocode origin hint')
    .option('--html <path>', 'write self-contained html report')
    .option('--json', 'emit JSONL on stdout instead of pretty terminal output')
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (prompt: string, opts) => {
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      const models = (opts.models as string[] | undefined) ?? [process.env.MODEL ?? 'anthropic/claude-haiku-4.5'];
      db.insertRun({ run_id, started_at: new Date().toISOString(), cmd: 'run' });
      const results = await runPromptAcrossModels({
        db, run_id, prompt_id: null, prompt, models, origin: parseCoord(opts.origin),
      });
      const renderInput = {
        prompt,
        results: results.map((r, i) => ({
          model: models[i],
          final_text: r.final_text,
          total_ms: r.total_ms,
          tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          tool_calls: r.tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          error: r.error,
        })),
      };
      if (opts.json) {
        const jsonl: JsonlTurn[] = results.map((r, i) => ({
          run_id, model: models[i], prompt,
          total_ms: r.total_ms,
          tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          final_text: r.final_text,
          tool_calls: r.tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          usage: null, error: r.error,
        }));
        process.stdout.write(renderJsonl(jsonl));
      } else {
        process.stdout.write(renderTerminal(renderInput));
      }
      if (opts.html) {
        const htmlInput = {
          run_id,
          title: 'ptv chat-eval — run',
          prompts: [{
            prompt,
            turns: results.map((r, i) => ({
              model: models[i],
              final_text: r.final_text,
              total_ms: r.total_ms,
              tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
              tool_calls: r.tool_calls.map((tc) => ({
                tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms,
                args_json: JSON.stringify(tc.args), result_json: tc.result_summary,
              })),
              error: r.error,
            })),
          }],
        };
        writeFileSync(resolve(opts.html), renderHtml(htmlInput));
      }
      db.close();
    });

  cmd
    .command('suite <file>')
    .description('Run all prompts in a YAML suite against one or more models')
    .option('--models <list>', 'comma-separated OpenRouter slugs', (v) => v.split(',').map((s) => s.trim()))
    .option('--html <path>', 'write self-contained html report')
    .option('--json', 'emit JSONL on stdout')
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (file: string, opts) => {
      const yaml = readFileSync(file, 'utf8');
      const suite = parseSuite(yaml);
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      const models = (opts.models as string[] | undefined) ?? [process.env.MODEL ?? 'anthropic/claude-haiku-4.5'];
      db.insertRun({ run_id, started_at: new Date().toISOString(), cmd: 'suite', suite_name: suite.name });
      const allTurns: JsonlTurn[] = [];
      const htmlSections: Array<{ prompt: string; turns: any[] }> = [];
      for (const p of suite.prompts) {
        const results = await runPromptAcrossModels({
          db, run_id, prompt_id: p.id, prompt: p.prompt, models, origin: p.origin ?? null,
        });
        for (let i = 0; i < models.length; i++) {
          allTurns.push({
            run_id, model: models[i], prompt: p.prompt,
            total_ms: results[i].total_ms,
            tool_total_ms: results[i].tool_calls.reduce((a, b) => a + b.duration_ms, 0),
            final_text: results[i].final_text,
            tool_calls: results[i].tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
            usage: null, error: results[i].error,
          });
        }
        htmlSections.push({
          prompt: p.prompt,
          turns: results.map((r, i) => ({
            model: models[i], final_text: r.final_text, total_ms: r.total_ms,
            tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
            tool_calls: r.tool_calls.map((tc) => ({
              tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms,
              args_json: JSON.stringify(tc.args), result_json: tc.result_summary,
            })),
            error: r.error,
          })),
        });
        // Fix 1: evaluate expect_keywords — warn to stderr on misses, never fail the run.
        const keywords = suite.expect_keywords?.[p.id] ?? [];
        if (keywords.length > 0) {
          for (let i = 0; i < models.length; i++) {
            const text = (results[i].final_text ?? '').toLowerCase();
            const modelSlug = models[i].replace(/\//g, '_');
            for (const kw of keywords) {
              if (!text.includes(kw.toLowerCase())) {
                process.stderr.write(`⚠ [${suite.name}/${p.id}/${modelSlug}] missing keyword: "${kw}"\n`);
              }
            }
          }
        }
        if (opts.json) {
          // Stream per-prompt for long suites; otherwise terminal renderer below is shown at end.
        } else {
          process.stdout.write(renderTerminal({ prompt: p.prompt, results: htmlSections[htmlSections.length - 1].turns }));
        }
      }
      if (opts.json) process.stdout.write(renderJsonl(allTurns));
      if (opts.html) writeFileSync(resolve(opts.html), renderHtml({ run_id, title: `ptv chat-eval — ${suite.name}`, prompts: htmlSections }));
      db.close();
    });

  cmd
    .command('replay <conversation>')
    .description('Replay a logged conversation_id against a different model')
    .requiredOption('--model <slug>', 'OpenRouter model slug')
    .option('--from-turn <n>', 'start replay at this turn_seq', (v) => parseInt(v, 10))
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (conversationId: string, opts) => {
      if (!process.env.PTV_CHAT_PG_URL) {
        console.error('PTV_CHAT_PG_URL is not set — replay requires postgres access.');
        process.exit(2);
      }
      const evs = await fetchConversationEvents(process.env.PTV_CHAT_PG_URL, conversationId);
      const r = reconstructFromEvents(evs, { fromTurn: opts.fromTurn });
      if (!r.replayPrompt) { console.error('No user prompt found for replay.'); process.exit(2); }
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      db.insertRun({
        run_id, started_at: new Date().toISOString(), cmd: 'replay',
        notes: `source conversation_id=${conversationId}`,
      });
      const results = await runPromptAcrossModels({
        db, run_id, prompt_id: null, prompt: r.replayPrompt, models: [opts.model], origin: null,
        history: r.historyForReplay,
      });
      const goldenText = r.turns[r.turns.length - 1].goldenAssistant;
      process.stdout.write(renderTerminal({
        prompt: `[replay ${conversationId.slice(0,8)}…] ${r.replayPrompt}`,
        results: [{
          model: 'GOLDEN', final_text: goldenText,
          total_ms: 0, tool_total_ms: 0, tool_calls: [], error: null,
        }, {
          model: opts.model, final_text: results[0].final_text, total_ms: results[0].total_ms,
          tool_total_ms: results[0].tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          tool_calls: results[0].tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          error: results[0].error,
        }],
      }));
      // Fix 2: print Jaccard word-set similarity between golden and new response.
      const score = jaccard(goldenText ?? '', results[0].final_text ?? '');
      process.stdout.write(`Jaccard(words): ${score.toFixed(2)}\n`);
      db.close();
    });

  return cmd;
}
