import { ZodError } from "zod";

const DEFAULT_BODY_LIMIT = 64 * 1024;

export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export async function readBody(req, { maxBytes = DEFAULT_BODY_LIMIT } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function parseInput(schema, input) {
  try {
    return schema.parse(input);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    throw new HttpError(
      400,
      "INVALID_REQUEST",
      "The request contains invalid or missing values.",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    );
  }
}

export async function readJson(req, schema) {
  const body = await readBody(req);
  if (!body) return schema ? parseInput(schema, {}) : {};
  const contentType = String(req.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Request body must use application/json.");
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  return schema ? parseInput(schema, value) : value;
}

export function positiveInteger(value, name = "identifier") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "INVALID_IDENTIFIER", `${name} must be a positive integer.`);
  }
  return parsed;
}

export function errorPayload(error, requestId) {
  const statusCode = Number(error?.statusCode) || 500;
  const publicMessage = statusCode >= 500
    ? "The server could not complete that request."
    : error?.message || "Request failed.";
  return {
    statusCode,
    body: {
      success: false,
      error: publicMessage,
      code: statusCode >= 500 ? "INTERNAL_ERROR" : error?.code || "REQUEST_FAILED",
      ...(statusCode < 500 && error?.details ? { details: error.details } : {}),
      ...(requestId ? { requestId } : {})
    }
  };
}
