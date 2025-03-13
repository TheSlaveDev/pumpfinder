import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { processMintLog } from "./MintUtils";

const CONFIG = JSON.parse(readFileSync("config.json", "utf-8"));
const RPC_URL: string = CONFIG.RPC_URL || "https://api.mainnet-beta.solana.com";
const CONCURRENCY: number = CONFIG.CONCURRENCY || 25;

const connection = new Connection(RPC_URL, "confirmed");

const ACCOUNT = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
const START_BEFORE_SIGNATURE =
  "nQWNjnJMVGFaqA7CzQQQMzM6gqacJTnzzFZHyKk1PM4H2axjR973jtMjvnVjVW7KjBPU1p7vBTZrAgsKtwozJZS";

const TOTAL = 20000;
const BATCH_SIZE = 1000;
const OUTPUT_DIR = "batches";

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR);

type ExtractedResult =
  | {
      signature: string;
      tokenAddress: string;
      timestamp: string | null;
    }
  | { skipped: true }
  | null;

async function extractTransactionInfo(
  signature: string,
  attempt = 1
): Promise<ExtractedResult> {
  try {
    const tx: ParsedTransactionWithMeta | null =
      await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

    if (!tx?.meta?.logMessages) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 100));
        return extractTransactionInfo(signature, attempt + 1);
      } else {
        return null;
      }
    }

    const mint = processMintLog(tx.meta.logMessages);
    const blockTime = tx.blockTime
      ? new Date(tx.blockTime * 1000).toISOString()
      : null;

    if (!mint?.mintAddress) return { skipped: true };

    return {
      signature,
      tokenAddress: mint.mintAddress,
      timestamp: blockTime,
    };
  } catch {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 100));
      return extractTransactionInfo(signature, attempt + 1);
    } else {
      return null;
    }
  }
}

async function withConcurrency<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const res = await handler(items[i]);
      results.push(res);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function getSignatures(before?: string, limit = 1000): Promise<string[]> {
  const signatures = await connection.getSignaturesForAddress(ACCOUNT, {
    before,
    limit,
  });
  return signatures.map((s) => s.signature);
}

async function main() {
  let before = START_BEFORE_SIGNATURE;
  let fetchedSignatures: string[] = [];

  console.log(`📡 Fetching ${TOTAL} signatures...\n`);
  while (fetchedSignatures.length < TOTAL) {
    const remaining = TOTAL - fetchedSignatures.length;
    const limit = Math.min(BATCH_SIZE, remaining);
    const sigs = await getSignatures(before, limit);
    if (sigs.length === 0) break;

    fetchedSignatures.push(...sigs);
    before = sigs[sigs.length - 1];

    const percent = ((fetchedSignatures.length / TOTAL) * 100).toFixed(1);
    process.stdout.write(
      `⏳ ${fetchedSignatures.length}/${TOTAL} (${percent}%) signatures fetched...\r`
    );
  }

  console.log(`\n✅ Finished fetching ${fetchedSignatures.length} signatures.`);

  let totalPumpCount = 0;
  let totalValid = 0;
  let totalSkipped = 0;
  const totalBatches = Math.ceil(fetchedSignatures.length / BATCH_SIZE);

  let oldestPumpToken: { tokenAddress: string; timestamp: string } | null =
    null;

  for (let i = 0; i < totalBatches; i++) {
    const batchSigs = fetchedSignatures.slice(
      i * BATCH_SIZE,
      (i + 1) * BATCH_SIZE
    );
    const parsed = await withConcurrency(
      batchSigs,
      extractTransactionInfo,
      CONCURRENCY
    );

    const validMints = parsed
      .filter(
        (
          tx
        ): tx is {
          signature: string;
          tokenAddress: string;
          timestamp: string | null;
        } => tx !== null && !("skipped" in tx)
      )
      .filter((tx) => tx.timestamp !== null)
      .sort((a, b) => {
        const aTime = new Date(a.timestamp!).getTime();
        const bTime = new Date(b.timestamp!).getTime();
        return aTime - bTime;
      });

    const skippedCount = parsed.filter((tx) => tx && "skipped" in tx).length;
    const pumpCAs = validMints.filter((tx) => tx.tokenAddress.endsWith("pump"));

    totalValid += validMints.length;
    totalSkipped += skippedCount;
    totalPumpCount += pumpCAs.length;

    const oldest = pumpCAs.length > 0 ? pumpCAs[0] : null;

    console.log(`\n📦 Batch ${i + 1}/${totalBatches}`);
    console.log(`Pump tokens found: ${pumpCAs.length}`);
    if (oldest) {
      console.log(
        `Oldest 'pump' CA: ${oldest.tokenAddress} at ${oldest.timestamp}`
      );
    } else {
      console.log(`No 'pump' token found in this batch.`);
    }

    if (skippedCount > 0) {
      console.log(`⛔ Skipped ${skippedCount} non-Pump.fun transactions`);
    }

    for (const tx of pumpCAs) {
      if (tx.timestamp) {
        if (
          !oldestPumpToken ||
          new Date(tx.timestamp).getTime() <
            new Date(oldestPumpToken.timestamp).getTime()
        ) {
          oldestPumpToken = {
            tokenAddress: tx.tokenAddress,
            timestamp: tx.timestamp,
          };
        }
      }
    }

    writeFileSync(
      `${OUTPUT_DIR}/batch_${i + 1}.json`,
      JSON.stringify(validMints, null, 2)
    );
  }

  console.log(
    `\n🎯 Pump tokens found: ${totalPumpCount} / ${totalValid} valid transactions`
  );
  console.log(`⛔ Skipped total: ${totalSkipped} non-Pump.fun mints`);

  if (oldestPumpToken) {
    console.log(
      `\n🧠 First pumpfun token ending with 'pump': ${oldestPumpToken.tokenAddress} at ${oldestPumpToken.timestamp}`
    );
  } else {
    console.log("\n⚠️ No pumpfun token ending in 'pump' was found.");
  }
}

main().catch(console.error);
