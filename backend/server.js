import 'dotenv/config';
import { createApp } from './api.js';

const PORT = process.env.PORT || 3001;

const app = await createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PrecisionShot API running on port ${PORT}`);
});
