const express = require('express');
const path = require('path');
const apiRoutes = require('./api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📊 Moltbook Monitor running on http://localhost:${PORT}`);
});
