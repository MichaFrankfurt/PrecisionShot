import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import analyzeRoutes from './routes/analyze.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token fehlt' });

  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

app.use('/api/auth', authRoutes);
app.use('/api/sessions', authMiddleware, sessionRoutes);
app.use('/api/analyze', authMiddleware, analyzeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`PrecisionShot API läuft auf Port ${PORT}`));
