import mongoose from 'mongoose';

export const normalizeMongoDatabaseIdentity = (uri) => {
  let client;
  try {
    client = new mongoose.mongo.MongoClient(uri);
  } catch {
    throw new Error('MongoDB connection URI is invalid.');
  }
  const { dbName, hosts = [] } = client.options;
  const srvHost = client.s.options?.srvHost;
  const normalizedHosts = srvHost
    ? [`srv:${srvHost.toLowerCase()}`]
    : hosts.map(({ host, port }) => `${host.toLowerCase()}:${port}`).sort();
  if (!dbName || !normalizedHosts.length) throw new Error('MongoDB connection URI does not identify a database.');
  return `${normalizedHosts.join(',')}|${dbName}`;
};

const parseMongoUri = (value, variableName) => {
  if (!value) throw new Error(`${variableName} is required.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid MongoDB connection URI.`);
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${variableName} must use mongodb:// or mongodb+srv://.`);
  }
  return parsed;
};

export const validateIsolatedMongoUri = (testValue, productionValue) => {
  const testUri = parseMongoUri(testValue, 'ATTENDANCE_TEST_MONGO_URI');
  const productionUri = parseMongoUri(productionValue, 'MONGO_URI');
  if (decodeURIComponent(testUri.pathname.slice(1)) !== 'nivhr_test' ||
      testUri.searchParams.getAll('dbName').some((database) => database !== 'nivhr_test')) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must select exactly the nivhr_test database.');
  }
  const authSources = [...testUri.searchParams.entries()]
    .filter(([name]) => name.toLowerCase() === 'authsource');
  if (authSources.length !== 1 || authSources[0][1] !== 'admin') {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must include exactly one authSource=admin option.');
  }
  if (normalizeMongoDatabaseIdentity(testValue) === normalizeMongoDatabaseIdentity(productionValue)) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must be different from MONGO_URI.');
  }
  return testValue;
};
