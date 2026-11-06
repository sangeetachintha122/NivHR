import mongoose from 'mongoose';

const getHealth = (_req, res) => {
  res.status(200).json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
};

export default getHealth;
