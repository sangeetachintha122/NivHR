import 'dotenv/config';
import app from './app.js';
import connectDatabase from './config/database.js';

const port = Number(process.env.PORT) || 5000;

try {
  await connectDatabase();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
