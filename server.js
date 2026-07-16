const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Import chat handler
const chatHandler = require('./api/chat.js').default;

// API endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const mockReq = {
      method: 'POST',
      json: async () => req.body,
      headers: {
        get: (name) => req.headers[name.toLowerCase()]
      }
    };
    
    const response = await chatHandler(mockReq);
    const data = await response.json();
    
    if (response.status !== 200) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/chat`);
});
