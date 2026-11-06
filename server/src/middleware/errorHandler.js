const errorHandler = (err, _req, res, _next) => {
  console.error(err);
  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : err.type === 'entity.parse.failed'
      ? 400
      : 500;
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
