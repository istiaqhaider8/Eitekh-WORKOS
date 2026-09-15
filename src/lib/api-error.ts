import { NextResponse } from "next/server";
import { logger } from "./logger";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleApiError(error: unknown, context?: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    );
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  const logContext = context || "API";

  logger.error("API_ERROR", `[${logContext}] ${message}`, {
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 },
  );
}
