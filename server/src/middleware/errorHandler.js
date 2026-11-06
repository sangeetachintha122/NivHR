const errorHandler = (err, _req, res, _next) => {
  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : err.type === 'entity.parse.failed'
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
      statusCode >= 500
        ? 'Internal server error'
        : err.type === 'entity.parse.failed'
          ? 'Invalid JSON request body'
          : err.message,
  });
};

export default errorHandler;
