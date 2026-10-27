/**
 * 创建带稳定错误码的普通 Error
 * @param message - 面向用户的错误信息
 * @param code - 稳定错误码
 * @param cause - 原始错误
 * @returns 带 code 的 Error
 */
export const createError = (message, code, cause) => {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
};

/**
 * 将未知错误转成可读文本
 * @param error - 未知错误
 * @returns 错误信息
 */
export const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error ?? "未知错误");
