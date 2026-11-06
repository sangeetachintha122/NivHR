import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import healthRoutes from './routes/healthRoutes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api', healthRoutes);
app.use(errorHandler);

export default app;
