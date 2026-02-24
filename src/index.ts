import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { runLoveMatchPipeline } from "./pipeline.js";
import { MatchRequest, PersonProfileSchema } from "./types.js";

type CliArgs = {
  seekerPath: string;
  candidatesPath: string;
  topK: number;
};

function parseCliArgs(argv: string[]): CliArgs {
  const argMap = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      argMap.set(key, value);
      i += 1;
    }
  }

  const seekerPath = argMap.get("--seeker") ?? "data/seeker.json";
  const candidatesPath = argMap.get("--candidates") ?? "data/candidates.json";
  const topKRaw = argMap.get("--top");
  const topK = topKRaw ? Number.parseInt(topKRaw, 10) : 5;

  return {
    seekerPath,
    candidatesPath,
    topK: Number.isFinite(topK) && topK > 0 ? topK : 5
  };
}

async function readJson<T>(relativePath: string): Promise<T> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const content = await readFile(absolutePath, "utf-8");
  return JSON.parse(content) as T;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const seeker = PersonProfileSchema.parse(await readJson(args.seekerPath));
  const candidates = PersonProfileSchema.array().parse(await readJson(args.candidatesPath));

  const request: MatchRequest = {
    seeker,
    candidates,
    topK: args.topK
  };

  const results = await runLoveMatchPipeline(request);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Pipeline failed: ${message}\n`);
  process.exit(1);
});
