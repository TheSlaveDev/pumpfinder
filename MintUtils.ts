// src/TransactionUtils.ts
import * as bs58 from "bs58";
import { Buffer } from "buffer";

// Mint Class
export class Mint {
  name: string;
  symbol: string;
  uri: string;
  mintAddress: string;
  bondingCurve: string;
  user: string;

  constructor(decodedData: Record<string, any>) {
    this.name = decodedData.name.data;
    this.symbol = decodedData.symbol.data;
    this.uri = decodedData.uri.data;
    this.mintAddress = decodedData.mint.data;
    this.bondingCurve = decodedData.bondingCurve.data;
    this.user = decodedData.user.data;
  }

  // Converts the Mint instance to a JSON object
  toJSON() {
    return {
      name: this.name,
      symbol: this.symbol,
      uri: this.uri,
      mint: this.mintAddress,
      bondingCurve: this.bondingCurve,
      user: this.user,
    };
  }

  // Converts the Mint instance to a string
  toString() {
    return JSON.stringify(this.toJSON(), null, 2);
  }
}

// Utility Functions
export function decodeMint(data: string): Mint {
  const decoded = Buffer.from(data, "base64");

  let offset = 0;

  const readLengthPrefixedString = (data: Uint8Array, offset: number) => {
    const length = data[offset];

    offset += 4; // Move past the length field
    const stringData = new TextDecoder("utf-8").decode(
      data.slice(offset, offset + length)
    );
    offset += length;
    return { value: stringData, offset };
  };

  const result: Record<string, any> = {};

  // Program (16 bytes public key)
  const program = bs58.default.encode(decoded.slice(offset, offset + 8));
  result.program = { type: "publicKey", data: program };
  offset += 8;

  // Name (length-prefixed string)
  const name = readLengthPrefixedString(decoded, offset);
  result.name = { type: "string", data: name.value };
  offset = name.offset;

  // Symbol (length-prefixed string)
  const symbol = readLengthPrefixedString(decoded, offset);
  result.symbol = { type: "string", data: symbol.value };
  offset = symbol.offset;

  // URI (length-prefixed string)
  const uri = readLengthPrefixedString(decoded, offset);
  result.uri = { type: "string", data: uri.value };
  offset = uri.offset;

  // Mint (32 bytes public key)
  const mint = bs58.default.encode(decoded.slice(offset, offset + 32));
  result.mint = { type: "publicKey", data: mint };
  offset += 32;

  // BondingCurve (32 bytes public key)
  const bondingCurve = bs58.default.encode(decoded.slice(offset, offset + 32));
  result.bondingCurve = { type: "publicKey", data: bondingCurve };
  offset += 32;

  // User (32 bytes public key)
  const user = bs58.default.encode(decoded.slice(offset, offset + 32));
  result.user = { type: "publicKey", data: user };
  offset += 32;

  return new Mint(result);
}

export function processMintLog(logs: string[]): Mint | null {
  const dataPrefix = "Program data: G3KpTd7rY3";
  const programSuccessLine =
    "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success";

  for (let i = 0; i < logs.length; i++) {
    if (logs[i] === programSuccessLine) {
      // Check the next line
      const nextLine = logs[i + 1];
      if (nextLine && nextLine.startsWith(dataPrefix)) {
        const encodedData = nextLine.replace("Program data: ", "").trim();
        try {
          // Decode the mint data and return it
          return decodeMint(encodedData);
        } catch (error) {
          console.error("Failed to decode Mint data:", error);
          return null;
        }
      }
    }
  }

  return null;
}
