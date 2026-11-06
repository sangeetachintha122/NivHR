const errorHandler = (err, _req, res, _next) => {
  const isUploadError =
    err.name === 'MulterError' ||
    (typeof err.code === 'string' && err.code.startsWith('LIMIT_'));
  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : err.type === 'entity.parse.failed'
      ? 400
      : isUploadError
        ? 400
        : 500;
  console.error({
    method: _req.method,
    path: _req.path,
    statusCode,
    message: err.message || 'Unknown error',
  });
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    status: 'error',
    message:
      err.code === 'AI_SERVICE_UNAVAILABLE'
        ? 'AI service unavailable'
        : err.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the 5 MB limit'
          : err.name === 'MulterError'
            ? 'Invalid file upload; upload exactly one file using the file field'
            : statusCode >= 500
        ? 'Internal server error'
        : err.type === 'entity.parse.failed'
          ? 'Invalid JSON request body'
          : err.message,
  });
};

export default errorHandler;
