import type {
  ApiErrorPayload,
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../contracts.js";

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
  };
}

export function errorResponse(error: ApiErrorPayload): ApiErrorResponse {
  return {
    success: false,
    error,
  };
}
