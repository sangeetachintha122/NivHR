const errorHandler = (err, _req, res, _next) => {
  console.error(err);
  const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  res.status(statusCode).json({
    status: 'error',
    message: statusCode >= 500 ? 'Internal server error' : err.message,
  });
};

export default errorHandler;
