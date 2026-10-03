export class AppError extends Error { constructor(statusCode,message,code='REQUEST_FAILED',errors=[]){super(message);this.statusCode=statusCode;this.code=code;this.errors=errors;} }
